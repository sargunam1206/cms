import dayjs from 'dayjs';
import { Employee } from '../employees/model';
import { Project, Task } from '../projects/model';
import { TimeLog } from '../timesheets/model';
import { Estimate } from './model';
import { getRateCard, getVariance } from './service';

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (actual: number, est: number) => (est > 0 ? round2(((actual - est) / est) * 100) : null);
export const UNASSIGNED = '(no module)';
export const OTHER_ROLE = 'Other';

export type Flag = 'ok' | 'warn' | 'alert' | 'none';
export function flagFor(overPct: number | null, warnPct: number, alertPct: number): Flag {
  if (overPct == null) return 'none';
  if (overPct >= alertPct) return 'alert';
  if (overPct >= warnPct) return 'warn';
  return 'ok';
}

/**
 * Estimated against actual for one project, measured against its approved estimate.
 * Actual cost is hours × the cost rate of the person's role. A person's role is the rate-card role their designation
 * matches; anyone who matches none is costed at the estimate's blended hourly rate and listed as "rate assumed".
 * Rates are the current rate card (history of rate changes is not replayed).
 */
export async function projectVariance(projectId: unknown, today = dayjs().format('YYYY-MM-DD')) {
  const est = await Estimate.findOne({ project: projectId, status: 'approved' }).lean();
  if (!est) return null;
  const [card, thresholds, byEmp, byTask, byDate, tasks] = await Promise.all([
    getRateCard(),
    getVariance(),
    TimeLog.aggregate([{ $match: { project: projectId } }, { $group: { _id: '$employee', minutes: { $sum: '$minutes' } } }]),
    TimeLog.aggregate([{ $match: { project: projectId } }, { $group: { _id: '$task', minutes: { $sum: '$minutes' } } }]),
    TimeLog.aggregate([{ $match: { project: projectId } }, { $group: { _id: '$date', minutes: { $sum: '$minutes' } } }]),
    Task.find({ project: projectId }).select('status estimateHours').lean(),
  ]);
  const people = await Employee.find({ _id: { $in: byEmp.map((e) => e._id) } }).select('name code designation').lean();
  const roleByName = new Map(card.roles.map((r) => [r.role.toLowerCase(), r]));
  const blended = est.totalHours > 0 ? est.totalCost / est.totalHours : 0;

  // ---- actual, per person (and per role through the person)
  const byPerson = byEmp
    .map((e) => {
      const p = people.find((x) => String(x._id) === String(e._id));
      const role = p?.designation ? roleByName.get(p.designation.trim().toLowerCase()) : undefined;
      const hours = e.minutes / 60;
      return { employee: { _id: e._id, name: p?.name ?? 'Former employee', code: p?.code }, role: role?.role ?? OTHER_ROLE, rateAssumed: !role, hours: round2(hours), cost: Math.round(hours * (role ? role.costRate : blended)) };
    })
    .sort((a, b) => b.hours - a.hours);
  const actualHours = round2(byPerson.reduce((s, p) => s + p.hours, 0));
  const actualCost = byPerson.reduce((s, p) => s + p.cost, 0);

  // ---- by role: estimate lines against the hours of people in that role
  const roles = new Map<string, { role: string; estHours: number; estCost: number; actHours: number; actCost: number }>();
  const slot = (role: string) => roles.get(role) ?? roles.set(role, { role, estHours: 0, estCost: 0, actHours: 0, actCost: 0 }).get(role)!;
  for (const l of est.lines) {
    const r = slot(l.role);
    r.estHours += l.hours;
    r.estCost += l.hours * l.costRate;
  }
  for (const p of byPerson) {
    const r = slot(p.role);
    r.actHours += p.hours;
    r.actCost += p.cost;
  }
  const byRole = [...roles.values()].map((r) => ({ ...r, estHours: round2(r.estHours), estCost: Math.round(r.estCost), actHours: round2(r.actHours), hoursOverPct: pct(r.actHours, r.estHours) }));

  // ---- by module: estimate lines against tasks tagged with that module
  const mods = new Map<string, { module: string; estHours: number; actHours: number }>();
  const mslot = (m: string) => mods.get(m) ?? mods.set(m, { module: m, estHours: 0, actHours: 0 }).get(m)!;
  for (const l of est.lines) mslot(l.module).estHours += l.hours;
  const taskIds = byTask.map((t) => String(t._id));
  const tagged = await Task.find({ _id: { $in: taskIds } }).select('estimateModule').lean();
  const tagOf = new Map(tagged.map((t) => [String(t._id), t.estimateModule || UNASSIGNED]));
  for (const t of byTask) mslot(tagOf.get(String(t._id)) ?? UNASSIGNED).actHours += t.minutes / 60;
  const byModule = [...mods.values()].filter((m) => m.estHours || m.actHours).map((m) => ({ ...m, estHours: round2(m.estHours), actHours: round2(m.actHours), hoursOverPct: pct(m.actHours, m.estHours) }));

  // ---- burn-up by week, and a forecast from progress
  const weeks = new Map<string, number>();
  for (const d of byDate) {
    const day = dayjs(d._id);
    const monday = day.subtract((day.day() + 6) % 7, 'day').format('YYYY-MM-DD');
    weeks.set(monday, (weeks.get(monday) ?? 0) + d.minutes / 60);
  }
  let run = 0;
  const burn = [...weeks.keys()].sort().slice(-26).map((w) => ({ week: w, hours: round2((run += weeks.get(w)!)) }));
  const weight = tasks.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
  const doneWeight = tasks.filter((t) => t.status === 'done').reduce((s, t) => s + (t.estimateHours ?? 0), 0);
  const progress = weight > 0 ? doneWeight / weight : tasks.length ? tasks.filter((t) => t.status === 'done').length / tasks.length : 0;
  const forecastHours = progress >= 0.1 ? round2(actualHours / progress) : null;

  const hoursOverPct = pct(actualHours, est.totalHours);
  const costOverPct = pct(actualCost, est.totalCost);
  return {
    estimate: { _id: est._id, version: est.version, totalHours: est.totalHours, totalCost: est.totalCost, approvedAt: est.decidedAt },
    actual: { hours: actualHours, cost: actualCost },
    hoursOverPct,
    costOverPct,
    flag: flagFor(Math.max(hoursOverPct ?? -Infinity, costOverPct ?? -Infinity) === -Infinity ? null : Math.max(hoursOverPct ?? -Infinity, costOverPct ?? -Infinity), thresholds.warnPct, thresholds.alertPct),
    hoursFlag: flagFor(hoursOverPct, thresholds.warnPct, thresholds.alertPct),
    thresholds,
    progress: round2(progress),
    forecastHours,
    forecastOverPct: forecastHours != null ? pct(forecastHours, est.totalHours) : null,
    byRole,
    byModule,
    byPerson,
    burn,
    today,
  };
}

/** One row per project that has an approved estimate: the portfolio report. */
export async function varianceReport() {
  const ests = await Estimate.find({ status: 'approved' }).select('project version totalHours totalCost').lean();
  const projects = await Project.find({ _id: { $in: ests.map((e) => e.project) } }).select('code name status manager').populate('manager', 'name').lean();
  const logs = await TimeLog.aggregate([{ $match: { project: { $in: ests.map((e) => e.project) } } }, { $group: { _id: { project: '$project', employee: '$employee' }, minutes: { $sum: '$minutes' } } }]);
  const people = await Employee.find({ _id: { $in: logs.map((l) => l._id.employee) } }).select('designation').lean();
  const card = await getRateCard();
  const thresholds = await getVariance();
  const roleByName = new Map(card.roles.map((r) => [r.role.toLowerCase(), r.costRate]));
  const desig = new Map(people.map((p) => [String(p._id), (p.designation ?? '').trim().toLowerCase()]));
  return ests
    .flatMap((e) => {
      const p = projects.find((x) => String(x._id) === String(e.project));
      if (!p) return [];
      const blended = e.totalHours > 0 ? e.totalCost / e.totalHours : 0;
      let hours = 0;
      let cost = 0;
      for (const l of logs.filter((x) => String(x._id.project) === String(e.project))) {
        const h = l.minutes / 60;
        hours += h;
        cost += h * (roleByName.get(desig.get(String(l._id.employee)) ?? '') ?? blended);
      }
      const hoursOverPct = pct(hours, e.totalHours);
      const costOverPct = pct(cost, e.totalCost);
      const worst = Math.max(hoursOverPct ?? -Infinity, costOverPct ?? -Infinity);
      return [{
        project: { _id: p._id, code: p.code, name: p.name, status: p.status, manager: (p.manager as unknown as { name: string } | null)?.name },
        version: e.version,
        estHours: e.totalHours,
        actHours: round2(hours),
        hoursOverPct,
        estCost: e.totalCost,
        actCost: Math.round(cost),
        costOverPct,
        flag: flagFor(worst === -Infinity ? null : worst, thresholds.warnPct, thresholds.alertPct),
      }];
    })
    .sort((a, b) => a.project.code.localeCompare(b.project.code));
}
