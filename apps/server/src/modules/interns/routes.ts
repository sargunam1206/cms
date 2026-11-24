import express, { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import {
  DEFAULT_INTERN_CHECKLIST,
  INTERN_STATUS,
  INTERN_TASK_STATUS,
  PERMISSIONS,
  internAllocationSchema,
  internChecklistSchema,
  internLogSchema,
  internSchema,
  internStatusSchema,
  internTaskSchema,
  internTaskStatusSchema,
  internUpdateSchema,
  objectId,
  stipendPaymentSchema,
  type InternInput,
} from '@cms/shared';
import { hasPermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { escapeRegex } from '../../utils/regex';
import { now, todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { hashPassword } from '../auth/service';
import { Employee } from '../employees/model';
import { employeeName, notify, usersOfEmployees } from '../notifications/service';
import { checkUpload } from '../projects/files';
import { Project, Task } from '../projects/model';
import { AttendanceDay, RegularizationRequest } from '../attendance/model';
import { LeaveBalance, LeaveRequest } from '../leave/model';
import { TimeLog, Timesheet } from '../timesheets/model';
import { Meeting } from '../meetings/model';
import { Enquiry } from '../enquiries/model';
import { Idea } from '../ideas/model';
import { Milestone } from '../milestones/model';
import { ConfidentialFolder } from '../confidential/model';
import { Notification } from '../notifications/model';
import { RefreshToken, Role, User } from '../users/model';
import { InternDoc, InternDocFile, InternTask, Internship } from './model';

export const internsRouter = Router();
const P = PERMISSIONS;
const MAX_BYTES = 10 * 1024 * 1024;
const raw = express.raw({ type: () => true, limit: MAX_BYTES });
const idParam = validate(z.object({ id: objectId }), 'params');
const taskParam = validate(z.object({ taskId: objectId }), 'params');
const PERSON = 'name code email phone department designation status type workType';
const same = (a: unknown, b: unknown) => a != null && b != null && String((a as any)?._id ?? a) === String((b as any)?._id ?? b);

const manages = (req: Request) => hasPermission(req, P.INTERNS_MANAGE);
const isMentor = (req: Request, i: { mentor?: unknown }) => same(i.mentor, req.user!.employeeId);
const isSelf = (req: Request, i: { employee?: unknown }) => same(i.employee, req.user!.employeeId);
/** Anyone who may look at this intern: HR/Management, their mentor, or the intern. */
const canSee = (req: Request, i: { mentor?: unknown; employee?: unknown }) => manages(req) || isMentor(req, i) || isSelf(req, i);
/** Gives and reviews work, ticks onboarding, allocates to projects: HR/Management or the mentor. */
const canGuide = (req: Request, i: { mentor?: unknown }) => manages(req) || isMentor(req, i);

/** Every route needs some intern right; finer checks are per record. */
internsRouter.use((req, _res, next) => {
  if (manages(req) || hasPermission(req, P.INTERNS_MENTOR) || hasPermission(req, P.INTERN_SELF)) return next();
  next(forbidden('You do not have access to interns'));
});

async function internshipOf(req: Request, employeeId: string) {
  const i = await Internship.findOne({ employee: employeeId });
  if (!i || !canSee(req, i)) throw notFound('Intern');
  return i;
}
const paise = (rupees: number) => Math.round(rupees * 100);
/** Records made before "company" interns existed only have `college`. */
const orgOf = (i: { organization?: string | null; college?: string | null }) => i.organization || i.college || '';
const by = (req: Request) => employeeName(req.user!.employeeId);

// ---------- Lists ----------
const listQuery = z.object({ status: z.enum(INTERN_STATUS).optional(), q: z.string().max(100).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

internsRouter.get(
  '/',
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const { status, q, month = todayStr().slice(0, 7) } = req.query as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = {};
    if (!manages(req)) filter.mentor = req.user!.employeeId; // mentors see their own interns
    if (status) filter.status = status;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      const emps = await Employee.find({ type: 'intern', $or: [{ name: rx }, { code: rx }, { email: rx }] }).select('_id').lean();
      filter.$or = [{ employee: { $in: emps.map((e) => e._id) } }, { organization: rx }, { college: rx }];
    }
    const items = await Internship.find(filter).populate('employee', PERSON).populate('mentor', 'name code').sort({ startDate: -1 }).lean();
    const ids = items.map((i) => (i.employee as any)?._id).filter(Boolean);
    const work = await InternTask.aggregate([
      { $match: { intern: { $in: ids } } },
      { $group: { _id: '$intern', total: { $sum: 1 }, approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } }, submitted: { $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] } } } },
    ]);
    const w = new Map(work.map((x) => [String(x._id), x]));
    // hours worked in the month, from check-in / check-out (all sessions for part-timers)
    const att = await AttendanceDay.aggregate([
      { $match: { employee: { $in: ids }, date: { $gte: `${month}-01`, $lte: `${month}-31` } } },
      { $group: { _id: '$employee', minutes: { $sum: '$workedMinutes' }, days: { $sum: { $cond: [{ $gt: ['$workedMinutes', 0] }, 1, 0] } } } },
    ]);
    const hrs = new Map(att.map((x) => [String(x._id), { minutes: x.minutes as number, days: x.days as number }]));
    res.json({
      items: items.map((i) => ({
        _id: (i.employee as any)?._id,
        employee: i.employee,
        source: i.source ?? 'college',
        organization: orgOf(i),
        course: i.course,
        startDate: i.startDate,
        endDate: i.endDate,
        mentor: i.mentor,
        status: i.status,
        payBasis: i.payBasis ?? 'monthly',
        stipend: i.stipend,
        hoursPerWeek: i.hoursPerWeek,
        onboarding: { done: i.checklist.filter((c) => c.done).length, total: i.checklist.length },
        work: w.get(String((i.employee as any)?._id)) ?? { total: 0, approved: 0, submitted: 0 },
        hours: hrs.get(String((i.employee as any)?._id)) ?? { minutes: 0, days: 0 },
      })),
      month,
      canManage: manages(req),
    });
  }),
);

/** People who can be mentors: active employees (not interns). */
internsRouter.get(
  '/mentors',
  ah(async (_req, res) => res.json(await Employee.find({ status: { $ne: 'exited' }, type: { $ne: 'intern' } }).select('name code designation department').sort({ name: 1 }).lean())),
);

/** Projects a mentor may allocate an intern to (active projects). */
internsRouter.get(
  '/projects',
  ah(async (_req, res) => res.json(await Project.find({ status: { $in: ['planning', 'active', 'on_hold'] } }).select('code name').sort({ code: 1 }).lean())),
);

/** The signed-in intern's own internship. */
internsRouter.get(
  '/me',
  ah(async (req, res) => {
    const i = await Internship.findOne({ employee: req.user!.employeeId }).populate('mentor', 'name code designation email phone').populate('allocations.project', 'code name').lean();
    if (!i) throw notFound('Internship');
    const { stipendPayments: _s, ...rest } = i;
    res.json(rest);
  }),
);

// ---------- Work board ----------
const workQuery = z.object({ intern: objectId.optional(), status: z.enum(INTERN_TASK_STATUS).optional() });

internsRouter.get(
  '/work',
  validate(workQuery, 'query'),
  ah(async (req, res) => {
    const { intern, status } = req.query as z.infer<typeof workQuery>;
    const me = req.user!.employeeId;
    const filter: Record<string, unknown> = {};
    if (!manages(req)) {
      const mentees = (await Internship.find({ mentor: me }).select('employee').lean()).map((i) => i.employee);
      filter.intern = { $in: [...mentees, me].filter(Boolean) }; // my own work (as an intern) and my mentees'
    }
    if (intern) filter.$and = [{ intern }];
    if (status) filter.status = status;
    const tasks = await InternTask.find(filter).populate('intern', 'name code').populate('mentor', 'name').populate('project', 'code name').sort({ status: 1, dueDate: 1, createdAt: -1 }).lean();
    res.json(
      tasks.map((t) => ({
        ...t,
        loggedMinutes: t.logs.reduce((s, l) => s + (l.minutes ?? 0), 0),
        mine: same(t.intern, me),
        canReview: manages(req) || same(t.mentor, me),
      })),
    );
  }),
);

async function taskOf(req: Request) {
  const t = await InternTask.findById(req.params.taskId);
  if (!t) throw notFound('Task');
  const i = await Internship.findOne({ employee: t.intern });
  if (!i || !canSee(req, i)) throw notFound('Task');
  return { t, i };
}

internsRouter.put(
  '/tasks/:taskId',
  taskParam,
  validate(internTaskSchema),
  ah(async (req, res) => {
    const { t, i } = await taskOf(req);
    if (!canGuide(req, i)) throw forbidden('Only the mentor or HR can change this task');
    const b = req.body as z.infer<typeof internTaskSchema>;
    t.set({ title: b.title, description: b.description || '', kind: b.kind, project: b.project || null, dueDate: b.dueDate || null, estimateHours: b.estimateHours });
    await t.save();
    res.json(t);
  }),
);

internsRouter.delete(
  '/tasks/:taskId',
  taskParam,
  ah(async (req, res) => {
    const { t, i } = await taskOf(req);
    if (!canGuide(req, i)) throw forbidden('Only the mentor or HR can delete this task');
    await t.deleteOne();
    await audit({ actor: req.user!.id, action: 'intern.task_delete', entity: 'InternTask', entityId: t._id, before: { title: t.title } });
    res.json({ ok: true });
  }),
);

/** The intern logs time and what they did on a day. */
internsRouter.post(
  '/tasks/:taskId/logs',
  taskParam,
  validate(internLogSchema),
  ah(async (req, res) => {
    const { t, i } = await taskOf(req);
    if (!isSelf(req, i)) throw forbidden('Only the intern can log work on their task');
    if (req.body.date > todayStr()) throw badRequest('You cannot log work for a future date');
    if (t.status === 'approved') throw conflict('This task is already approved');
    await InternTask.updateOne({ _id: t._id }, { $push: { logs: { ...req.body, at: now() } }, ...(t.status === 'assigned' ? { $set: { status: 'in_progress' } } : {}) });
    res.status(201).json({ ok: true });
  }),
);

/** Intern: start or submit. Mentor/HR: approve or send back for a redo, with feedback. */
internsRouter.post(
  '/tasks/:taskId/status',
  taskParam,
  validate(internTaskStatusSchema),
  ah(async (req, res) => {
    const { t, i } = await taskOf(req);
    const { status, note, rating } = req.body as z.infer<typeof internTaskStatusSchema>;
    const guide = canGuide(req, i);
    if (status === 'in_progress' || status === 'submitted') {
      if (!isSelf(req, i)) throw forbidden('Only the intern starts or submits their task');
      if (t.status === 'approved') throw conflict('This task is already approved');
      t.status = status;
      if (status === 'submitted') t.submittedNote = note || '';
      await t.save();
      if (status === 'submitted' && t.mentor) {
        await notify({ type: 'intern.submitted', to: await usersOfEmployees([t.mentor]), actor: req.user!.id, title: `Submitted for review: ${t.title}`, body: `${await by(req)}${note ? `: ${note}` : ''}`, link: '/intern-work', entity: { kind: 'InternTask', id: t._id } });
      }
    } else if (status === 'approved' || status === 'redo') {
      if (!guide) throw forbidden('Only the mentor or HR reviews intern work');
      t.status = status;
      t.reviews.push({ outcome: status, rating, note: note || '', byName: await by(req), at: now() } as never);
      await t.save();
      await notify({ type: 'intern.task', to: await usersOfEmployees([t.intern]), actor: req.user!.id, title: status === 'approved' ? `Approved: ${t.title}` : `Please redo: ${t.title}`, body: note || undefined, link: '/intern-work', entity: { kind: 'InternTask', id: t._id } });
    } else {
      if (!guide) throw forbidden('Only the mentor or HR can reset a task');
      t.status = status;
      await t.save();
    }
    await audit({ actor: req.user!.id, action: 'intern.task_status', entity: 'InternTask', entityId: t._id, meta: { title: t.title, status } });
    res.json(t);
  }),
);

// ---------- Create an intern ----------
internsRouter.post(
  '/',
  validate(internSchema),
  ah(async (req, res) => {
    if (!manages(req)) throw forbidden('Only HR or Management can add interns');
    const b = req.body as InternInput;
    const code = b.code.toUpperCase();
    if (await Employee.exists({ code })) throw conflict(`Code ${code} is already used`);
    if (b.password && (await User.exists({ email: b.email }))) throw conflict('A login with that email already exists');
    if (b.mentor && !(await Employee.exists({ _id: b.mentor }))) throw notFound('Mentor');
    const emp = await Employee.create({
      code,
      name: b.name,
      email: b.email || undefined,
      phone: b.phone || undefined,
      department: b.department || undefined,
      designation: b.designation || 'Intern',
      manager: b.mentor || null, // the mentor approves their leave and attendance corrections
      dateOfJoining: b.startDate,
      type: 'intern',
      workType: b.workType,
      pfApplicable: false,
      esiApplicable: false,
    });
    const i = await Internship.create({
      employee: emp._id,
      source: b.source,
      organization: b.organization,
      course: b.course || '',
      yearOfStudy: b.yearOfStudy || '',
      startDate: b.startDate,
      endDate: b.endDate,
      mentor: b.mentor || null,
      payBasis: b.payBasis,
      stipend: paise(b.stipend),
      hoursPerWeek: b.payBasis === 'hourly' ? b.hoursPerWeek : undefined,
      checklist: DEFAULT_INTERN_CHECKLIST.map((label) => ({ label, done: false })),
      history: [{ at: now(), byName: await by(req), to: 'onboarding' }],
    });
    if (b.password) {
      const role = await Role.findOne({ name: 'Intern' });
      if (!role) throw badRequest('The Intern role is missing; run the seed');
      await User.create({ email: b.email, passwordHash: await hashPassword(b.password), role: role._id, employee: emp._id });
    }
    await audit({ actor: req.user!.id, action: 'intern.create', entity: 'Employee', entityId: emp._id, meta: { code, name: emp.name, organization: i.organization } });
    res.status(201).json({ _id: emp._id, code });
  }),
);

// ---------- One intern ----------
internsRouter.get(
  '/:id',
  idParam,
  ah(async (req, res) => {
    const i = await internshipOf(req, req.params.id);
    const full = await Internship.findById(i._id).populate('employee', PERSON).populate('mentor', 'name code designation').populate('allocations.project', 'code name').lean();
    const [docs, login] = await Promise.all([
      InternDoc.find({ intern: req.params.id }).sort({ createdAt: -1 }).lean(),
      User.findOne({ employee: req.params.id }).select('email status').lean(),
    ]);
    const showMoney = manages(req) || isSelf(req, i);
    res.json({
      ...full,
      source: full!.source ?? 'college',
      organization: orgOf(full!),
      payBasis: full!.payBasis ?? 'monthly',
      _id: req.params.id, // pages address an intern by their employee id
      internshipId: full!._id,
      stipend: showMoney ? full!.stipend : undefined,
      stipendPayments: manages(req) ? full!.stipendPayments : undefined,
      documents: docs,
      login: login ? { email: login.email, status: login.status } : null,
      canManage: manages(req),
      canGuide: canGuide(req, i),
      isSelf: isSelf(req, i),
    });
  }),
);

internsRouter.put(
  '/:id',
  idParam,
  validate(internUpdateSchema),
  ah(async (req, res) => {
    if (!manages(req)) throw forbidden('Only HR or Management can edit interns');
    const i = await internshipOf(req, req.params.id);
    const b = req.body as z.infer<typeof internUpdateSchema>;
    await Employee.updateOne(
      { _id: req.params.id },
      { $set: { name: b.name, email: b.email || null, phone: b.phone || null, department: b.department || null, designation: b.designation || 'Intern', manager: b.mentor || null, workType: b.workType } },
    );
    i.set({
      source: b.source,
      organization: b.organization,
      course: b.course || '',
      yearOfStudy: b.yearOfStudy || '',
      startDate: b.startDate,
      endDate: b.endDate,
      mentor: b.mentor || null,
      payBasis: b.payBasis,
      stipend: paise(b.stipend),
      hoursPerWeek: b.payBasis === 'hourly' ? b.hoursPerWeek : undefined,
    });
    await i.save();
    await audit({ actor: req.user!.id, action: 'intern.update', entity: 'Employee', entityId: req.params.id, meta: { name: b.name } });
    res.json({ ok: true });
  }),
);

internsRouter.patch(
  '/:id/status',
  idParam,
  validate(internStatusSchema),
  ah(async (req, res) => {
    if (!manages(req)) throw forbidden('Only HR or Management can change an intern\'s status');
    const i = await internshipOf(req, req.params.id);
    const b = req.body as z.infer<typeof internStatusSchema>;
    if (b.status === 'converted') throw badRequest('Use "Convert to employee" for that');
    const from = i.status;
    i.status = b.status;
    if (b.status === 'completed' || b.status === 'dropped') {
      const date = b.date || todayStr();
      i.completion = { date, rating: b.rating, feedback: b.feedback || '', certificateIssued: !!b.certificateIssued, byName: await by(req) } as never;
      // leaving ends their access and takes them off attendance
      await Employee.updateOne({ _id: req.params.id }, { $set: { status: 'exited', exitDate: date } });
      const u = await User.findOneAndUpdate({ employee: req.params.id }, { status: 'disabled' });
      if (u) await RefreshToken.updateMany({ user: u._id, revokedAt: null }, { revokedAt: new Date() });
    } else if (from === 'completed' || from === 'dropped') {
      await Employee.updateOne({ _id: req.params.id }, { $set: { status: 'active', exitDate: null } });
      await User.updateOne({ employee: req.params.id }, { status: 'active' });
    }
    i.history.push({ at: now(), byName: await by(req), from, to: b.status } as never);
    await i.save();
    await audit({ actor: req.user!.id, action: 'intern.status', entity: 'Employee', entityId: req.params.id, meta: { from, to: b.status } });
    res.json({ ok: true });
  }),
);

/** Hire the intern: they become an employee (Employee role, back on the Employees list, included in payroll). */
internsRouter.post(
  '/:id/convert',
  idParam,
  validate(z.object({ code: z.string().trim().min(2).max(30).optional(), designation: z.string().trim().max(80).optional(), dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  ah(async (req, res) => {
    if (!manages(req)) throw forbidden('Only HR or Management can convert an intern');
    const i = await internshipOf(req, req.params.id);
    if (i.status === 'converted') throw conflict('Already converted');
    const set: Record<string, unknown> = { type: 'employee', workType: 'full_time', status: 'active', exitDate: null, dateOfJoining: req.body.dateOfJoining };
    if (req.body.designation) set.designation = req.body.designation;
    if (req.body.code) {
      const code = req.body.code.toUpperCase();
      if (await Employee.exists({ code, _id: { $ne: req.params.id } })) throw conflict(`Code ${code} is already used`);
      set.code = code;
    }
    await Employee.updateOne({ _id: req.params.id }, { $set: set });
    const role = await Role.findOne({ name: 'Employee' });
    if (role) await User.updateOne({ employee: req.params.id }, { role: role._id, status: 'active' });
    i.history.push({ at: now(), byName: await by(req), from: i.status, to: 'converted' } as never);
    i.status = 'converted';
    await i.save();
    await audit({ actor: req.user!.id, action: 'intern.convert', entity: 'Employee', entityId: req.params.id, meta: set });
    res.json({ ok: true });
  }),
);

/** Hours worked in a month (from attendance check-in/out, and time logged on intern tasks): the basis for hourly stipends. */
internsRouter.get(
  '/:id/hours',
  idParam,
  validate(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }), 'query'),
  ah(async (req, res) => {
    const i = await internshipOf(req, req.params.id);
    if (!manages(req) && !isSelf(req, i)) throw forbidden('Only HR or the intern can see this');
    const month = String(req.query.month);
    const range = { $gte: `${month}-01`, $lte: `${month}-31` };
    const [att, logs] = await Promise.all([
      AttendanceDay.aggregate([
        { $match: { employee: i.employee, date: range } },
        { $group: { _id: null, minutes: { $sum: '$workedMinutes' }, days: { $sum: { $cond: [{ $gt: ['$workedMinutes', 0] }, 1, 0] } } } },
      ]),
      InternTask.aggregate([{ $match: { intern: i.employee } }, { $unwind: '$logs' }, { $match: { 'logs.date': range } }, { $group: { _id: null, minutes: { $sum: '$logs.minutes' } } }]),
    ]);
    const payBasis = i.payBasis ?? 'monthly';
    const attendanceMinutes = att[0]?.minutes ?? 0;
    res.json({
      month,
      attendanceMinutes,
      daysWorked: att[0]?.days ?? 0,
      taskMinutes: logs[0]?.minutes ?? 0,
      payBasis,
      rate: i.stipend,
      // hourly: attendance hours x rate, rounded to the rupee (paise)
      suggestedAmount: payBasis === 'hourly' ? Math.round(((attendanceMinutes / 60) * (i.stipend ?? 0)) / 100) * 100 : i.stipend,
    });
  }),
);

/**
 * Remove an intern entirely, e.g. one added by mistake or who never joined. Their attendance, leave, timesheets,
 * work, documents and login go too. Someone who has since been hired, or who leads records others depend on
 * (a project, meetings, enquiries, ideas), cannot be deleted: mark them Completed or Dropped instead.
 */
internsRouter.delete(
  '/:id',
  idParam,
  ah(async (req, res) => {
    if (!manages(req)) throw forbidden('Only HR or Management can delete interns');
    const i = await internshipOf(req, req.params.id);
    if (i.status === 'converted') throw conflict('This intern has been hired as an employee and cannot be deleted here');
    const emp = i.employee;
    const [leads, organises, owns, ideas] = await Promise.all([
      Project.countDocuments({ manager: emp }),
      Meeting.countDocuments({ organizer: emp }),
      Enquiry.countDocuments({ owner: emp }),
      Idea.countDocuments({ author: emp }),
    ]);
    const blockers = [
      leads && `manages ${leads} project(s)`,
      organises && `organised ${organises} meeting(s)`,
      owns && `owns ${owns} enquiry(ies)`,
      ideas && `posted ${ideas} idea(s)`,
    ].filter(Boolean);
    if (blockers.length) throw conflict(`Cannot delete: this intern ${blockers.join(', ')}. Reassign those first, or mark the internship Dropped instead.`);

    const person = await Employee.findById(emp).select('code name').lean();
    const user = await User.findOne({ employee: emp }).select('_id email');
    const docs = await InternDoc.find({ intern: emp }).select('_id').lean();
    await Promise.all([
      InternTask.deleteMany({ intern: emp }),
      InternDocFile.deleteMany({ doc: { $in: docs.map((d) => d._id) } }),
      InternDoc.deleteMany({ intern: emp }),
      AttendanceDay.deleteMany({ employee: emp }),
      RegularizationRequest.deleteMany({ employee: emp }),
      LeaveBalance.deleteMany({ employee: emp }),
      LeaveRequest.deleteMany({ employee: emp }),
      TimeLog.deleteMany({ employee: emp }),
      Timesheet.deleteMany({ employee: emp }),
      Project.updateMany({ members: emp }, { $pull: { members: emp } }),
      Task.updateMany({ assignee: emp }, { $set: { assignee: null } }),
      Meeting.updateMany({ attendees: emp }, { $pull: { attendees: emp } }),
      Idea.updateMany({ voters: emp }, { $pull: { voters: emp } }),
      Milestone.updateMany({ owner: emp }, { $set: { owner: null } }),
      ConfidentialFolder.updateMany({ editors: emp }, { $pull: { editors: emp } }),
      Employee.updateMany({ manager: emp }, { $set: { manager: null } }),
    ]);
    if (user) {
      await Promise.all([RefreshToken.deleteMany({ user: user._id }), Notification.deleteMany({ user: user._id })]);
      await user.deleteOne();
    }
    await Internship.deleteOne({ _id: i._id });
    await Employee.deleteOne({ _id: emp });
    await audit({
      actor: req.user!.id,
      action: 'intern.delete',
      entity: 'Employee',
      entityId: emp,
      before: { code: person?.code, name: person?.name, organization: orgOf(i), login: user?.email },
    });
    res.json({ ok: true });
  }),
);

internsRouter.put(
  '/:id/checklist',
  idParam,
  validate(internChecklistSchema),
  ah(async (req, res) => {
    const i = await internshipOf(req, req.params.id);
    if (!canGuide(req, i)) throw forbidden('Only HR or the mentor can update onboarding');
    const prev = new Map(i.checklist.map((c) => [c.label, c]));
    const who = await by(req);
    i.set(
      'checklist',
      req.body.items.map((c: { label: string; done: boolean; note?: string }) => {
        const old = prev.get(c.label);
        const changed = !old || old.done !== c.done;
        return { label: c.label, done: c.done, note: c.note || '', doneAt: c.done ? (changed ? now() : old?.doneAt) : undefined, doneByName: c.done ? (changed ? who : old?.doneByName) : undefined };
      }),
    );
    // finishing every step moves a new intern from onboarding to active
    if (i.status === 'onboarding' && i.checklist.length && i.checklist.every((c) => c.done)) {
      i.history.push({ at: now(), byName: who, from: 'onboarding', to: 'active' } as never);
      i.status = 'active';
    }
    await i.save();
    res.json({ checklist: i.checklist, status: i.status });
  }),
);

internsRouter.post(
  '/:id/stipend',
  idParam,
  validate(stipendPaymentSchema),
  ah(async (req, res) => {
    if (!manages(req)) throw forbidden('Only HR or Management record stipend payments');
    const i = await internshipOf(req, req.params.id);
    const b = req.body as z.infer<typeof stipendPaymentSchema>;
    if (i.stipendPayments.some((p) => p.month === b.month)) throw conflict(`A payment for ${b.month} is already recorded`);
    i.stipendPayments.push({ month: b.month, hours: b.hours, amount: paise(b.amount), paidOn: b.paidOn, note: b.note || '', byName: await by(req), at: now() } as never);
    await i.save();
    await audit({ actor: req.user!.id, action: 'intern.stipend_paid', entity: 'Employee', entityId: req.params.id, meta: { month: b.month, amount: paise(b.amount) } });
    res.status(201).json({ ok: true });
  }),
);

internsRouter.delete(
  '/:id/stipend/:paymentId',
  validate(z.object({ id: objectId, paymentId: objectId }), 'params'),
  ah(async (req, res) => {
    if (!manages(req)) throw forbidden('Only HR or Management can remove a payment');
    const i = await internshipOf(req, req.params.id);
    const p = i.stipendPayments.id(req.params.paymentId);
    if (!p) throw notFound('Payment');
    p.deleteOne();
    await i.save();
    await audit({ actor: req.user!.id, action: 'intern.stipend_removed', entity: 'Employee', entityId: req.params.id, meta: { month: p.month } });
    res.json({ ok: true });
  }),
);

/** Put an intern on a project: also adds them to the project team so they can see it and log time. */
internsRouter.post(
  '/:id/allocations',
  idParam,
  validate(internAllocationSchema),
  ah(async (req, res) => {
    const i = await internshipOf(req, req.params.id);
    if (!canGuide(req, i)) throw forbidden('Only HR or the mentor allocates interns');
    const b = req.body as z.infer<typeof internAllocationSchema>;
    const p = await Project.findById(b.project).select('code name status');
    if (!p) throw notFound('Project');
    if (['completed', 'cancelled'].includes(p.status)) throw conflict(`${p.code} is ${p.status}`);
    i.allocations.push({ project: p._id, from: b.from, to: b.to || '', note: b.note || '', byName: await by(req), at: now() } as never);
    await i.save();
    await Project.updateOne({ _id: p._id }, { $addToSet: { members: i.employee } });
    await audit({ actor: req.user!.id, action: 'intern.allocate', entity: 'Employee', entityId: req.params.id, meta: { project: p.code } });
    res.status(201).json({ ok: true });
  }),
);

internsRouter.delete(
  '/:id/allocations/:allocationId',
  validate(z.object({ id: objectId, allocationId: objectId }), 'params'),
  ah(async (req, res) => {
    const i = await internshipOf(req, req.params.id);
    if (!canGuide(req, i)) throw forbidden('Only HR or the mentor changes allocations');
    const a = i.allocations.id(req.params.allocationId);
    if (!a) throw notFound('Allocation');
    const project = a.project;
    a.deleteOne();
    await i.save();
    // leave the project team only if no other allocation still points at it
    if (!i.allocations.some((x) => same(x.project, project))) await Project.updateOne({ _id: project }, { $pull: { members: i.employee } });
    res.json({ ok: true });
  }),
);

internsRouter.post(
  '/:id/tasks',
  idParam,
  validate(internTaskSchema),
  ah(async (req, res) => {
    const i = await internshipOf(req, req.params.id);
    if (!canGuide(req, i)) throw forbidden('Only the mentor or HR gives interns work');
    if (['completed', 'dropped', 'converted'].includes(i.status)) throw conflict(`This internship is ${i.status}`);
    const b = req.body as z.infer<typeof internTaskSchema>;
    const t = await InternTask.create({
      intern: i.employee,
      mentor: i.mentor ?? req.user!.employeeId,
      title: b.title,
      description: b.description || '',
      kind: b.kind,
      project: b.project || null,
      dueDate: b.dueDate || null,
      estimateHours: b.estimateHours,
      assignedBy: req.user!.id,
      assignedByName: await by(req),
    });
    await notify({ type: 'intern.task', to: await usersOfEmployees([i.employee]), actor: req.user!.id, title: `New task: ${t.title}`, body: t.dueDate ? `Due ${t.dueDate}` : undefined, link: '/intern-work', entity: { kind: 'InternTask', id: t._id } });
    res.status(201).json(t);
  }),
);

// ---------- Documents (offer letter, NOC, ID proof, certificates) ----------
internsRouter.post(
  '/:id/documents',
  idParam,
  validate(z.object({ name: z.string().min(1).max(200), title: z.string().trim().min(2).max(120) }), 'query'),
  raw,
  ah(async (req, res) => {
    const i = await internshipOf(req, req.params.id);
    if (!manages(req) && !isSelf(req, i)) throw forbidden('Only HR or the intern can add documents');
    const q = req.query as { name: string; title: string };
    const file = checkUpload(q.name, req.body, true);
    const d = await InternDoc.create({ intern: i.employee, title: q.title, name: file.name, mime: file.mime, size: file.data.length, uploadedBy: req.user!.id, uploadedByName: await by(req) });
    await InternDocFile.create({ doc: d._id, data: file.data });
    await audit({ actor: req.user!.id, action: 'intern.doc_add', entity: 'Employee', entityId: req.params.id, meta: { title: d.title, name: d.name } });
    res.status(201).json(d);
  }),
);

internsRouter.get(
  '/:id/documents/:docId',
  validate(z.object({ id: objectId, docId: objectId }), 'params'),
  ah(async (req, res) => {
    await internshipOf(req, req.params.id);
    const d = await InternDoc.findOne({ _id: req.params.docId, intern: req.params.id });
    const f = d && (await InternDocFile.findOne({ doc: d._id }));
    if (!d || !f) throw notFound('Document');
    await audit({ actor: req.user!.id, action: 'intern.doc_download', entity: 'Employee', entityId: req.params.id, meta: { title: d.title } });
    res.setHeader('Content-Type', d.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.attachment(d.name);
    res.send(f.data);
  }),
);

internsRouter.delete(
  '/:id/documents/:docId',
  validate(z.object({ id: objectId, docId: objectId }), 'params'),
  ah(async (req, res) => {
    if (!manages(req)) throw forbidden('Only HR or Management can remove intern documents');
    await internshipOf(req, req.params.id);
    const d = await InternDoc.findOneAndDelete({ _id: req.params.docId, intern: req.params.id });
    if (!d) throw notFound('Document');
    await InternDocFile.deleteOne({ doc: d._id });
    await audit({ actor: req.user!.id, action: 'intern.doc_remove', entity: 'Employee', entityId: req.params.id, meta: { title: d.title } });
    res.json({ ok: true });
  }),
);
