import dayjs from 'dayjs';
import { todayStr } from '../../utils/time';
import { notify, usersOfEmployees } from '../notifications/service';
import { Project, Task } from '../projects/model';
import { Milestone } from './model';

export type MilestoneState = 'done' | 'late' | 'at_risk' | 'on_track' | 'upcoming';
const days = (from: string, to: string) => dayjs(to).diff(dayjs(from), 'day');

interface M {
  plannedStart: string;
  plannedEnd: string;
  baselineEnd?: string | null;
  status: string;
  doneOn?: string | null;
}

/**
 * Where a milestone stands today.
 * - late: not done and its planned end has passed
 * - at risk: not done, and either the plan has slipped past the baseline, or it is due within a week with under 70% of its tasks done
 * - upcoming: has not started yet; on track: everything else
 * slipDays is how far the planned end (or the actual finish) is beyond the baseline; null with no baseline.
 */
export function milestoneState(m: M, progress: number | null, today = todayStr()) {
  const slipDays = m.baselineEnd ? days(m.baselineEnd, m.status === 'done' && m.doneOn ? m.doneOn : m.plannedEnd) : null;
  let state: MilestoneState;
  if (m.status === 'done') state = 'done';
  else if (m.plannedEnd < today) state = 'late';
  else if ((slipDays ?? 0) > 0 || (days(today, m.plannedEnd) <= 7 && m.plannedStart <= today && (progress ?? 0) < 0.7)) state = 'at_risk';
  else if (m.plannedStart > today) state = 'upcoming';
  else state = 'on_track';
  return { state, slipDays };
}

/** Share of linked tasks that are done (null when there are none). */
export async function progressOf(milestoneIds: unknown[]) {
  const rows = await Task.aggregate([
    { $match: { milestone: { $in: milestoneIds } } },
    { $group: { _id: '$milestone', total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } } } },
  ]);
  return new Map<string, { total: number; done: number }>(rows.map((r) => [String(r._id), { total: r.total, done: r.done }]));
}

/**
 * Tell the owner (or the project manager) about milestones that are late or at risk. A given state is announced
 * once, so running this daily does not repeat itself.
 */
export async function notifyMilestones(today = todayStr()) {
  const projects = await Project.find({ status: { $in: ['planning', 'active'] } }).select('code manager').lean();
  if (!projects.length) return 0;
  const byId = new Map(projects.map((p) => [String(p._id), p]));
  const open = await Milestone.find({ project: { $in: projects.map((p) => p._id) }, status: { $ne: 'done' } }).lean();
  const prog = await progressOf(open.map((m) => m._id));
  let sent = 0;
  for (const m of open) {
    const p = byId.get(String(m.project))!;
    const t = prog.get(String(m._id));
    const { state, slipDays } = milestoneState(m, t ? t.done / t.total : null, today);
    if (state !== 'late' && state !== 'at_risk') continue;
    await notify({
      type: 'milestone.late',
      to: await usersOfEmployees([m.owner ?? p.manager]),
      title: state === 'late' ? `${p.code}: "${m.name}" is late` : `${p.code}: "${m.name}" is at risk`,
      body: state === 'late' ? `Planned for ${m.plannedEnd}` : slipDays && slipDays > 0 ? `${slipDays} day${slipDays === 1 ? '' : 's'} behind the baseline` : `Due ${m.plannedEnd}, tasks not far enough along`,
      link: `/projects/${p._id}?tab=timeline`,
      entity: { kind: 'Milestone', id: m._id },
      dedupeKey: `${m._id}:${state}`,
    });
    sent++;
  }
  return sent;
}
