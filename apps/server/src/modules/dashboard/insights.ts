import type { Request } from 'express';
import dayjs from 'dayjs';
import { LOST, PERMISSIONS, WON } from '@cms/shared';
import { hasPermission } from '../../middleware/auth';
import { todayStr } from '../../utils/time';
import { RegularizationRequest } from '../attendance/model';
import { Employee, teamIds } from '../employees/model';
import { Enquiry } from '../enquiries/model';
import { varianceReport } from '../estimates/variance';
import { Holiday } from '../holidays/model';
import { Idea } from '../ideas/model';
import { getBalances } from '../leave/service';
import { LeaveRequest } from '../leave/model';
import { Milestone } from '../milestones/model';
import { milestoneState, progressOf } from '../milestones/service';
import { PayrollRun } from '../payroll/model';
import { Project, Task } from '../projects/model';

const P = PERMISSIONS;
const OPEN_PROJECT = ['planning', 'active', 'on_hold'];

/** Everything the role-based dashboard cards need, each block only for people allowed to see it. */
export async function insightsFor(req: Request) {
  const can = (...perms: (typeof P)[keyof typeof P][]) => perms.some((p) => hasPermission(req, p));
  const me = req.user!.employeeId;
  const today = todayStr();
  const month = today.slice(0, 7);
  const out: Record<string, unknown> = {};
  const jobs: Promise<void>[] = [];
  const run = (fn: () => Promise<void>) => jobs.push(fn());

  // ---- me: leave balances and the next holidays
  if (me)
    run(async () => {
      const [balances, holidays] = await Promise.all([
        getBalances(me, Number(today.slice(0, 4))).catch(() => []),
        Holiday.find({ date: { $gte: today }, optional: false }).sort({ date: 1 }).limit(3).select('date name').lean(),
      ]);
      out.me = { balances: balances.map((b) => ({ code: b.leaveType.code, name: b.leaveType.name, available: b.available })), holidays };
    });

  // ---- HR: pending requests, joiners and leavers, the payroll run in progress
  if (can(P.LEAVE_MANAGE, P.EMPLOYEES_MANAGE))
    run(async () => {
      const [pendingLeave, pendingRegularization, joiners, exits, current] = await Promise.all([
        LeaveRequest.countDocuments({ status: 'pending' }),
        RegularizationRequest.countDocuments({ status: 'pending' }),
        Employee.countDocuments({ dateOfJoining: { $gte: `${month}-01`, $lte: `${month}-31` } }),
        Employee.countDocuments({ exitDate: { $gte: `${month}-01`, $lte: `${month}-31` } }),
        PayrollRun.findOne({ month }).select('month status').lean(),
      ]);
      out.hr = { pendingLeave, pendingRegularization, joiners, exits, payrollRun: current ? { month: current.month, status: current.status } : null };
    });

  // ---- payroll cost: the latest approved month
  if (can(P.PAYROLL_VIEW))
    run(async () => {
      const r = await PayrollRun.findOne({ status: { $in: ['approved', 'locked'] } }).sort({ month: -1 }).select('month status totals').lean();
      out.payroll = r ? { month: r.month, status: r.status, employees: r.totals?.employees ?? 0, gross: r.totals?.gross ?? 0, net: r.totals?.net ?? 0, employerContributions: r.totals?.employerContributions ?? 0 } : null;
    });

  // ---- projects: everyone with the all-projects right sees all; a lead sees the ones they lead
  if (can(P.PROJECTS_VIEW, P.PROJECTS_MANAGE))
    run(async () => {
      const all = can(P.PROJECTS_VIEW);
      const projects = await Project.find({ status: { $in: OPEN_PROJECT }, ...(all ? {} : { manager: me ?? null }) }).select('code name status').lean();
      const ids = projects.map((p) => p._id);
      const [milestones, overdueTasks] = await Promise.all([
        Milestone.find({ project: { $in: ids }, status: { $ne: 'done' } }).lean(),
        Task.countDocuments({ project: { $in: ids }, status: { $ne: 'done' }, dueDate: { $lt: today, $ne: null } }),
      ]);
      const prog = await progressOf(milestones.map((m) => m._id));
      const per = new Map<string, { late: number; atRisk: number }>();
      const total = { late: 0, at_risk: 0, on_track: 0, upcoming: 0 };
      for (const m of milestones) {
        const t = prog.get(String(m._id));
        const { state } = milestoneState(m, t ? t.done / t.total : null, today);
        if (state === 'done') continue;
        total[state]++;
        const row = per.get(String(m.project)) ?? { late: 0, atRisk: 0 };
        if (state === 'late') row.late++;
        if (state === 'at_risk') row.atRisk++;
        per.set(String(m.project), row);
      }
      const worst = projects
        .map((p) => ({ _id: p._id, code: p.code, name: p.name, ...(per.get(String(p._id)) ?? { late: 0, atRisk: 0 }) }))
        .filter((p) => p.late || p.atRisk)
        .sort((a, b) => b.late - a.late || b.atRisk - a.atRisk)
        .slice(0, 5);
      const byStatus: Record<string, number> = {};
      for (const p of projects) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      out.projects = { scope: all ? 'all' : 'mine', open: projects.length, byStatus, milestones: total, overdueTasks, worst };
    });

  // ---- estimates running over
  if (can(P.ESTIMATES_VIEW))
    run(async () => {
      const rows = await varianceReport();
      const counts = { ok: 0, warn: 0, alert: 0 };
      for (const r of rows) if (r.flag !== 'none') counts[r.flag]++;
      const over = rows
        .filter((r) => r.flag === 'warn' || r.flag === 'alert')
        .map((r) => ({ _id: r.project._id, code: r.project.code, name: r.project.name, flag: r.flag, hoursOverPct: r.hoursOverPct, costOverPct: r.costOverPct }))
        .sort((a, b) => Math.max(b.hoursOverPct ?? 0, b.costOverPct ?? 0) - Math.max(a.hoursOverPct ?? 0, a.costOverPct ?? 0))
        .slice(0, 5);
      out.estimates = { counts, over };
    });

  // ---- enquiries: the pipeline in the caller's scope, and what to chase today
  if (can(P.ENQUIRIES_SELF, P.ENQUIRIES_VIEW, P.ENQUIRIES_MANAGE))
    run(async () => {
      const all = can(P.ENQUIRIES_VIEW, P.ENQUIRIES_MANAGE);
      const team = !all && me ? await teamIds(me) : [];
      const scope = all ? {} : { owner: team.length ? { $in: [me, ...team] } : (me ?? null) };
      const [counts, due] = await Promise.all([
        Enquiry.aggregate([{ $match: scope }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Enquiry.find({ ...scope, status: { $nin: [WON, LOST] }, nextFollowUp: { $lte: today } })
          .select('name company status nextFollowUp owner')
          .populate('owner', 'name')
          .sort({ nextFollowUp: 1 })
          .limit(6)
          .lean(),
      ]);
      const by = Object.fromEntries(counts.map((c) => [c._id, c.n]));
      const won = by[WON] ?? 0;
      const lost = by[LOST] ?? 0;
      const open = counts.filter((c) => c._id !== WON && c._id !== LOST).reduce((s, c) => s + c.n, 0);
      const dueCount = await Enquiry.countDocuments({ ...scope, status: { $nin: [WON, LOST] }, nextFollowUp: { $lte: today } });
      out.enquiries = { scope: all ? 'all' : team.length ? 'team' : 'mine', stages: counts.filter((c) => c._id !== WON && c._id !== LOST).map((c) => ({ stage: c._id, n: c.n })), open, won, lost, conversionRate: won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : null, dueCount, due: due.map((d) => ({ ...d, overdue: d.nextFollowUp! < today })) };
    });

  // ---- ideas: what people are backing, and (for reviewers) what is waiting
  if (can(P.IDEAS_SELF, P.IDEAS_MANAGE))
    run(async () => {
      const [trending, waiting] = await Promise.all([
        Idea.find({ status: { $nin: ['done', 'declined'] } }).sort({ votes: -1, createdAt: -1 }).limit(3).select('title votes status').lean(),
        can(P.IDEAS_MANAGE) ? Idea.countDocuments({ status: 'submitted' }) : Promise.resolve(null),
      ]);
      out.ideas = { trending, awaitingReview: waiting };
    });

  await Promise.all(jobs);
  out.generatedAt = dayjs().toISOString();
  return out;
}
