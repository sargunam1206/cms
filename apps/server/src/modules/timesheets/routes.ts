import dayjs from 'dayjs';
import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectId, submitWeekSchema, timeLogSchema, timesheetDecisionSchema, timesheetRulesSchema, weekQuerySchema } from '@cms/shared';
import { hasPermission, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { escapeRegex } from '../../utils/regex';
import { now, todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { approversOf, employeeName, notify, usersOfEmployees } from '../notifications/service';
import { Employee } from '../employees/model';
import { Project, Task } from '../projects/model';
import { TimeLog, Timesheet } from './model';
import { getRules, mondayOf, saveRules, setLog, weekGrid } from './service';

export const timesheetsRouter = Router();
const P = PERMISSIONS;
const self = requirePermission(P.TASKS_SELF);
const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

/** Approves someone's timesheet: their reporting manager, or HR/Admin (attendance.all). Never your own. */
async function isApproverOf(req: Request, employeeId: unknown) {
  if (same(employeeId, req.user!.employeeId)) return false;
  if (hasPermission(req, P.ATTENDANCE_ALL)) return true;
  const emp = await Employee.findById(employeeId).select('manager').lean();
  return same(emp?.manager, req.user!.employeeId);
}

// ----- Rules -----
timesheetsRouter.get('/rules', self, ah(async (_req, res) => res.json(await getRules())));
timesheetsRouter.put(
  '/rules',
  requirePermission(P.SETTINGS_MANAGE),
  validate(timesheetRulesSchema),
  ah(async (req, res) => {
    const before = await getRules();
    await saveRules(req.body, req.user!.id);
    await audit({ actor: req.user!.id, action: 'timesheet.rules_update', entity: 'Setting', entityId: 'timesheetRules', before, after: req.body });
    res.json(await getRules());
  }),
);

// ----- The weekly grid -----
timesheetsRouter.get(
  '/week',
  self,
  validate(weekQuerySchema, 'query'),
  ah(async (req, res) => {
    const { start, employee } = req.query as { start?: string; employee?: string };
    const weekStart = mondayOf(start ?? todayStr());
    const me = requireEmployee(req);
    const target = employee ?? String(me);
    if (!same(target, me) && !(await isApproverOf(req, target)) && !hasPermission(req, P.PROJECTS_VIEW)) throw forbidden('You can only see your own timesheet or your team\'s');
    res.json(await weekGrid(target, weekStart));
  }),
);

/** Tasks I can put time on: open tasks in running projects I belong to. */
timesheetsRouter.get(
  '/tasks',
  self,
  validate(z.object({ q: z.string().max(100).optional() }), 'query'),
  ah(async (req, res) => {
    const me = requireEmployee(req);
    const projects = await Project.find({ $or: [{ manager: me }, { members: me }], status: { $in: ['planning', 'active', 'on_hold'] } }).select('code name').lean();
    const filter: Record<string, unknown> = { project: { $in: projects.map((p) => p._id) }, status: { $ne: 'done' } };
    const q = (req.query as { q?: string }).q;
    if (q) filter.title = new RegExp(escapeRegex(q), 'i');
    const code = new Map(projects.map((p) => [String(p._id), p]));
    const tasks = await Task.find(filter).select('number title status project').sort({ updatedAt: -1 }).limit(50).lean();
    res.json(tasks.map((t) => ({ _id: t._id, ref: `${code.get(String(t.project))!.code}-${t.number}`, title: t.title, project: { _id: t.project, name: code.get(String(t.project))!.name } })));
  }),
);

/** Set the minutes for a task on a day (0 removes it). */
timesheetsRouter.put(
  '/log',
  self,
  validate(timeLogSchema),
  ah(async (req, res) => {
    const me = requireEmployee(req);
    res.json(await setLog(String(me), req.body, (p) => same(p.manager, me) || p.members.some((m) => same(m, me))));
  }),
);

// ----- Submit and approve -----
timesheetsRouter.post(
  '/submit',
  self,
  validate(submitWeekSchema),
  ah(async (req, res) => {
    const me = String(requireEmployee(req));
    const rules = await getRules();
    if (!rules.requireApproval) throw badRequest('Timesheets do not need approval; your logged time is already counted');
    const weekStart = req.body.weekStart as string;
    if (dayjs(weekStart).day() !== 1) throw badRequest('A week starts on Monday');
    if (weekStart > mondayOf(todayStr())) throw badRequest('You cannot submit a future week');
    const total = (await TimeLog.find({ employee: me, date: { $gte: weekStart, $lte: dayjs(weekStart).add(6, 'day').format('YYYY-MM-DD') } }).select('minutes').lean()).reduce((s, l) => s + l.minutes, 0);
    if (!total) throw badRequest('Log some time before submitting the week');
    const existing = await Timesheet.findOne({ employee: me, weekStart });
    if (existing && ['submitted', 'approved'].includes(existing.status)) throw conflict(`This week is already ${existing.status}`);
    const sheet = await Timesheet.findOneAndUpdate(
      { employee: me, weekStart },
      { employee: me, weekStart, status: 'submitted', totalMinutes: total, submittedAt: now(), comment: null, decidedBy: null, decidedAt: null },
      { upsert: true, new: true },
    );
    await audit({ actor: req.user!.id, action: 'timesheet.submit', entity: 'Timesheet', entityId: sheet._id, meta: { weekStart, minutes: total } });
    await notify({ type: 'timesheet.submitted', to: await approversOf(me), actor: req.user!.id, title: `${await employeeName(me)} submitted a timesheet`, body: `Week of ${weekStart} · ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} h`, link: '/timesheets/approvals', entity: { kind: 'Timesheet', id: sheet._id } });
    res.json(sheet);
  }),
);

/** Submitted timesheets waiting for me. */
timesheetsRouter.get(
  '/pending',
  self,
  ah(async (req, res) => {
    const me = requireEmployee(req);
    const filter: Record<string, unknown> = { status: 'submitted' };
    if (!hasPermission(req, P.ATTENDANCE_ALL)) {
      const reports = await Employee.find({ manager: me }).select('_id').lean();
      filter.employee = { $in: reports.map((r) => r._id) };
    } else filter.employee = { $ne: me };
    res.json(await Timesheet.find(filter).populate('employee', 'name code').sort({ submittedAt: 1 }).limit(200).lean());
  }),
);

timesheetsRouter.post(
  '/:id/decision',
  self,
  validate(z.object({ id: objectId }), 'params'),
  validate(timesheetDecisionSchema),
  ah(async (req, res) => {
    const sheet = await Timesheet.findById(req.params.id);
    if (!sheet) throw notFound('Timesheet');
    if (!(await isApproverOf(req, sheet.employee))) throw forbidden('Only the employee\'s manager can decide this timesheet');
    if (sheet.status !== 'submitted') throw conflict(`This timesheet is ${sheet.status}`);
    const { decision, comment } = req.body as { decision: 'approved' | 'rejected'; comment?: string };
    if (decision === 'rejected' && (comment ?? '').length < 3) throw badRequest('Say what needs correcting');
    sheet.status = decision === 'approved' ? 'approved' : 'rejected';
    sheet.decidedBy = req.user!.id as never;
    sheet.decidedAt = now();
    sheet.comment = comment ?? null;
    await sheet.save();
    await audit({ actor: req.user!.id, action: `timesheet.${decision}`, entity: 'Timesheet', entityId: sheet._id, meta: { employee: sheet.employee, weekStart: sheet.weekStart, comment } });
    await notify({ type: 'timesheet.decided', to: await usersOfEmployees([sheet.employee]), actor: req.user!.id, title: `Your timesheet for the week of ${sheet.weekStart} was ${decision === 'approved' ? 'approved' : 'sent back'}`, body: comment, link: '/my/timesheet', entity: { kind: 'Timesheet', id: sheet._id } });
    res.json(sheet);
  }),
);
