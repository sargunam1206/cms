import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, TASK_PRIORITY, TASK_STATUS, clientSchema, objectId, projectSchema, taskCommentSchema, taskSchema, taskStatusSchema, PROJECT_STATUS } from '@cms/shared';
import { requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { escapeRegex } from '../../utils/regex';
import { now, todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { employeeName, notify, usersOfEmployees } from '../notifications/service';
import { Employee } from '../employees/model';
import { assertManage, canEditTask, canManage, canSee, isMember, projectForCaller, seesAll } from './access';
import { TimeLog } from '../timesheets/model';
import { Milestone } from '../milestones/model';
import { removeFilesOfTask } from './files';
import { ProjectDoc } from './documents';
import { Client, Project, Task } from './model';

export const projectsRouter = Router();
const P = PERMISSIONS;
const manageRight = requirePermission(P.PROJECTS_MANAGE);
const anyProjectRight = requirePermission(P.TASKS_SELF, P.PROJECTS_VIEW, P.PROJECTS_MANAGE);
const idParam = validate(z.object({ id: objectId }), 'params');

/** Blank strings from forms become null so clearing a field really clears it. */
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as T;
const EMP = 'name code';

// ===================== Clients =====================
projectsRouter.get(
  '/clients',
  requirePermission(P.PROJECTS_MANAGE, P.PROJECTS_VIEW),
  validate(z.object({ q: z.string().max(100).optional(), active: z.enum(['true', 'false']).optional() }), 'query'),
  ah(async (req, res) => {
    const { q, active } = req.query as { q?: string; active?: string };
    const filter: Record<string, unknown> = {};
    if (q) filter.name = new RegExp(escapeRegex(q), 'i');
    if (active) filter.active = active === 'true';
    res.json(await Client.find(filter).sort({ name: 1 }).limit(500).lean());
  }),
);

projectsRouter.post(
  '/clients',
  manageRight,
  validate(clientSchema),
  ah(async (req, res) => {
    if (await Client.exists({ name: new RegExp(`^${escapeRegex(req.body.name)}$`, 'i') })) throw conflict('A client with that name already exists');
    const c = await Client.create(clean(req.body));
    await audit({ actor: req.user!.id, action: 'client.create', entity: 'Client', entityId: c._id, after: req.body });
    res.status(201).json(c);
  }),
);

projectsRouter.put(
  '/clients/:id',
  manageRight,
  idParam,
  validate(clientSchema),
  ah(async (req, res) => {
    const before = await Client.findById(req.params.id).lean();
    if (!before) throw notFound('Client');
    const dup = await Client.exists({ _id: { $ne: req.params.id }, name: new RegExp(`^${escapeRegex(req.body.name)}$`, 'i') });
    if (dup) throw conflict('A client with that name already exists');
    const c = await Client.findByIdAndUpdate(req.params.id, clean(req.body), { new: true });
    await audit({ actor: req.user!.id, action: 'client.update', entity: 'Client', entityId: req.params.id, before, after: req.body });
    res.json(c);
  }),
);

/** Names for the member and manager pickers: only what is needed to choose someone, nothing else from the employee record. */
projectsRouter.get(
  '/people',
  requirePermission(P.PROJECTS_MANAGE, P.PROJECTS_VIEW),
  ah(async (_req, res) => {
    res.json(await Employee.find({ status: { $ne: 'exited' } }).select('name code department designation').sort({ name: 1 }).limit(1000).lean());
  }),
);

// ===================== My work =====================
projectsRouter.get(
  '/my/tasks',
  requirePermission(P.TASKS_SELF),
  validate(z.object({ scope: z.enum(['open', 'all', 'overdue']).default('open') }), 'query'),
  ah(async (req, res) => {
    const me = requireEmployee(req);
    const scope = (req.query as { scope: 'open' | 'all' | 'overdue' }).scope;
    const filter: Record<string, unknown> = { assignee: me };
    if (scope !== 'all') filter.status = { $ne: 'done' };
    if (scope === 'overdue') Object.assign(filter, { dueDate: { $lt: todayStr(), $ne: null } });
    const tasks = await Task.find(filter).select('-comments').populate('project', 'code name status').sort({ dueDate: 1, priority: -1 }).limit(300).lean();
    res.json(tasks.map((t) => ({ ...t, ref: `${(t.project as unknown as { code: string }).code}-${t.number}` })));
  }),
);

// ===================== Projects =====================
const listQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(PROJECT_STATUS).optional(),
  client: objectId.optional(),
  mine: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Task counts per project, in one query for the whole page. */
async function taskStats(projectIds: unknown[]) {
  const today = todayStr();
  const rows = await Task.aggregate([
    { $match: { project: { $in: projectIds } } },
    {
      $group: {
        _id: '$project',
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
        // a task with no due date is never overdue (a missing field would otherwise sort below any date)
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'done'] }, { $gt: [{ $ifNull: ['$dueDate', ''] }, ''] }, { $lt: [{ $ifNull: ['$dueDate', ''] }, today] }] }, 1, 0] } },
        estimateHours: { $sum: { $ifNull: ['$estimateHours', 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), { total: r.total as number, done: r.done as number, overdue: r.overdue as number, estimateHours: r.estimateHours as number }]));
}

projectsRouter.get(
  '/',
  anyProjectRight,
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const { q, status, client, mine, page, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const me = req.user!.employeeId;
    const filter: Record<string, unknown> = {};
    if (!seesAll(req) || mine === 'true') filter.$or = [{ manager: me }, { members: me }];
    if (status) filter.status = status;
    if (client) filter.client = client;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$and = [{ $or: [{ name: rx }, { code: rx }] }];
    }
    const [items, total] = await Promise.all([
      Project.find(filter).populate('client', 'name').populate('manager', EMP).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Project.countDocuments(filter),
    ]);
    const stats = await taskStats(items.map((p) => p._id));
    res.json({ items: items.map((p) => ({ ...p, stats: stats.get(String(p._id)) ?? { total: 0, done: 0, overdue: 0, estimateHours: 0 } })), total, page, limit });
  }),
);

/** Members must exist and be active; the manager is always a member. */
async function checkPeople(manager: string, members: string[]) {
  const ids = [...new Set([manager, ...members])];
  const found = await Employee.find({ _id: { $in: ids }, status: { $ne: 'exited' } }).select('_id').lean();
  if (found.length !== ids.length) throw badRequest('Every member must be an existing, current employee');
  return ids;
}

projectsRouter.post(
  '/',
  manageRight,
  validate(projectSchema),
  ah(async (req, res) => {
    const body = req.body as z.infer<typeof projectSchema>;
    // A Manager can start projects they lead themselves; Admin and Management can assign anyone as lead
    if (!seesAll(req) && String(body.manager) !== String(req.user!.employeeId)) throw forbidden('You can only create projects that you lead');
    if (await Project.exists({ code: body.code })) throw conflict(`Project code ${body.code} is already used`);
    if (body.client && !(await Client.exists({ _id: body.client }))) throw badRequest('Client not found');
    const members = await checkPeople(body.manager, body.members);
    const p = await Project.create({ ...clean(body), members, createdBy: req.user!.id });
    await audit({ actor: req.user!.id, action: 'project.create', entity: 'Project', entityId: p._id, after: { code: p.code, name: p.name, manager: p.manager } });
    await tellAdded(req, p, members);
    res.status(201).json(p);
  }),
);

projectsRouter.get(
  '/:id',
  anyProjectRight,
  idParam,
  ah(async (req, res) => {
    const p = await projectForCaller(req, req.params.id);
    const full = await Project.findById(p._id).populate('client').populate('manager', EMP).populate('members', EMP).lean();
    const stats = (await taskStats([p._id])).get(String(p._id)) ?? { total: 0, done: 0, overdue: 0, estimateHours: 0 };
    const byStatus = Object.fromEntries(TASK_STATUS.map((s) => [s, 0]));
    for (const r of await Task.aggregate([{ $match: { project: p._id } }, { $group: { _id: '$status', n: { $sum: 1 } } }])) byStatus[r._id] = r.n;
    res.json({ ...full, stats: { ...stats, byStatus }, canManage: canManage(req, p), canAddTasks: (canManage(req, p) || isMember(req, p)) && !['completed', 'cancelled'].includes(p.status) });
  }),
);

/** The project dashboard: hours against estimate, workload by person, what is late and what is coming. */
projectsRouter.get(
  '/:id/dashboard',
  anyProjectRight,
  idParam,
  ah(async (req, res) => {
    const p = await projectForCaller(req, req.params.id);
    const today = todayStr();
    const weekAhead = new Date(`${today}T00:00:00Z`);
    weekAhead.setUTCDate(weekAhead.getUTCDate() + 7);
    const soon = weekAhead.toISOString().slice(0, 10);

    const [tasks, logs] = await Promise.all([
      Task.find({ project: p._id }).select('number title status priority dueDate estimateHours assignee').populate('assignee', EMP).lean(),
      TimeLog.aggregate([
        { $match: { project: p._id } },
        { $group: { _id: { employee: '$employee', date: '$date' }, minutes: { $sum: '$minutes' } } },
      ]),
    ]);

    const loggedBy = new Map<string, number>();
    const byDate = new Map<string, number>();
    let logged = 0;
    for (const l of logs) {
      loggedBy.set(String(l._id.employee), (loggedBy.get(String(l._id.employee)) ?? 0) + l.minutes);
      byDate.set(l._id.date, (byDate.get(l._id.date) ?? 0) + l.minutes);
      logged += l.minutes;
    }

    // Logged hours per week, for the last eight weeks (Monday-based, oldest first)
    const monday = (d: string) => {
      const x = new Date(`${d}T00:00:00Z`);
      x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
      return x.toISOString().slice(0, 10);
    };
    const thisWeek = monday(today);
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(`${thisWeek}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 7 * (7 - i));
      return { weekStart: d.toISOString().slice(0, 10), minutes: 0 };
    });
    for (const [date, minutes] of byDate) {
      const w = weeks.find((x) => x.weekStart === monday(date));
      if (w) w.minutes += minutes;
    }

    type Person = { employee: { _id: string; name: string; code: string }; openTasks: number; doneTasks: number; estimateHours: number; loggedMinutes: number };
    const people = new Map<string, Person>();
    for (const t of tasks) {
      const a = t.assignee as unknown as { _id: string; name: string; code: string } | null;
      if (!a) continue;
      const row = people.get(String(a._id)) ?? { employee: a, openTasks: 0, doneTasks: 0, estimateHours: 0, loggedMinutes: loggedBy.get(String(a._id)) ?? 0 };
      if (t.status === 'done') row.doneTasks++;
      else row.openTasks++;
      row.estimateHours += t.estimateHours ?? 0;
      people.set(String(a._id), row);
    }

    const ref = (t: { number: number }) => `${p.code}-${t.number}`;
    const view = (t: (typeof tasks)[number]) => ({ _id: t._id, ref: ref(t), title: t.title, dueDate: t.dueDate, priority: t.priority, status: t.status, assignee: t.assignee });
    const open = tasks.filter((t) => t.status !== 'done' && t.dueDate);
    res.json({
      hours: { loggedMinutes: logged, estimateHours: tasks.reduce((s, t) => s + (t.estimateHours ?? 0), 0), budgetHours: p.budgetHours ?? null },
      byPerson: [...people.values()].sort((a, b) => b.loggedMinutes - a.loggedMinutes || a.employee.name.localeCompare(b.employee.name)),
      overdue: open.filter((t) => t.dueDate! < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)).slice(0, 10).map(view),
      upcoming: open.filter((t) => t.dueDate! >= today && t.dueDate! <= soon).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)).slice(0, 10).map(view),
      weeks,
    });
  }),
);

projectsRouter.put(
  '/:id',
  anyProjectRight,
  idParam,
  validate(projectSchema),
  ah(async (req, res) => {
    const p = await projectForCaller(req, req.params.id);
    assertManage(req, p);
    const body = req.body as z.infer<typeof projectSchema>;
    if (body.code !== p.code && (await Project.exists({ code: body.code, _id: { $ne: p._id } }))) throw conflict(`Project code ${body.code} is already used`);
    // A Manager cannot hand the project to someone else and keep editing it; only wider rights can reassign
    if (!seesAll(req) && String(body.manager) !== String(p.manager)) throw forbidden('Only Management can change the project manager');
    if (body.client && !(await Client.exists({ _id: body.client }))) throw badRequest('Client not found');
    const members = await checkPeople(body.manager, body.members);
    // Someone with open tasks cannot be removed from the project
    const removed = (p.members as unknown[]).map(String).filter((m) => !members.includes(m));
    if (removed.length) {
      const open = await Task.countDocuments({ project: p._id, assignee: { $in: removed }, status: { $ne: 'done' } });
      if (open) throw conflict(`${open} open task(s) are still assigned to the people you removed; reassign them first`);
    }
    const before = { name: p.name, status: p.status, manager: p.manager, members: p.members.length };
    const previous = (p.members as unknown[]).map(String);
    Object.assign(p, clean({ ...body, members }));
    await p.save();
    await tellAdded(req, p, members.filter((m) => !previous.includes(m)));
    await audit({ actor: req.user!.id, action: 'project.update', entity: 'Project', entityId: p._id, before, after: { name: p.name, status: p.status, manager: p.manager, members: p.members.length } });
    res.json(p);
  }),
);

// ===================== Tasks =====================
const taskListQuery = z.object({
  status: z.enum(TASK_STATUS).optional(),
  assignee: z.union([objectId, z.literal('me'), z.literal('none')]).optional(),
  priority: z.enum(TASK_PRIORITY).optional(),
  q: z.string().max(100).optional(),
  due: z.enum(['overdue', 'week']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

/** Tell the new assignee. */
async function tellAssigned(req: import('express').Request, t: { _id: unknown; number: number; title: string; assignee?: unknown }, p: { _id: unknown; code: string }) {
  const who = req.user!.employeeId ? (await Employee.findById(req.user!.employeeId).select('name').lean())?.name : undefined;
  await notify({ type: 'task.assigned', to: await usersOfEmployees([t.assignee as never]), actor: req.user!.id, title: `${who ?? 'Your manager'} assigned you ${p.code}-${t.number}`, body: t.title, link: `/projects/${p._id}`, entity: { kind: 'Task', id: t._id } });
}

/** Tell people who were just added to a project. */
async function tellAdded(req: import('express').Request, p: { _id: unknown; code: string; name: string }, memberIds: string[]) {
  if (!memberIds.length) return;
  await notify({ type: 'project.added', to: await usersOfEmployees(memberIds), actor: req.user!.id, title: `You were added to ${p.code} ${p.name}`, link: `/projects/${p._id}`, entity: { kind: 'Project', id: p._id } });
}

const taskView = (t: { number: number } & Record<string, unknown>, code: string) => ({ ...t, ref: `${code}-${t.number}` });

projectsRouter.get(
  '/:id/tasks',
  anyProjectRight,
  idParam,
  validate(taskListQuery, 'query'),
  ah(async (req, res) => {
    const p = await projectForCaller(req, req.params.id);
    const { status, assignee, priority, q, due, limit } = req.query as unknown as z.infer<typeof taskListQuery>;
    const filter: Record<string, unknown> = { project: p._id };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (assignee === 'me') filter.assignee = req.user!.employeeId;
    else if (assignee === 'none') filter.assignee = null;
    else if (assignee) filter.assignee = assignee;
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: rx }, { description: rx }];
    }
    const today = todayStr();
    if (due === 'overdue') Object.assign(filter, { dueDate: { $lt: today, $ne: null }, status: { $ne: 'done' } });
    if (due === 'week') {
      const end = new Date(`${today}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 7);
      Object.assign(filter, { dueDate: { $gte: today, $lte: end.toISOString().slice(0, 10) }, status: { $ne: 'done' } });
    }
    const tasks = await Task.find(filter).select('-comments').populate('assignee', EMP).sort({ status: 1, position: 1, number: 1 }).limit(limit).lean();
    res.json(tasks.map((t) => taskView(t as never, p.code)));
  }),
);

/** Next number in this project, handed out atomically so two people creating tasks never collide. */
async function nextNumber(projectId: unknown) {
  const p = await Project.findByIdAndUpdate(projectId, { $inc: { taskSeq: 1 } }, { new: true }).select('taskSeq');
  return p!.taskSeq;
}

async function assertAssigneeIsMember(project: { manager: unknown; members: unknown[] }, assignee?: string | null) {
  if (!assignee) return;
  if (!project.members.some((m) => String(m) === String(assignee)) && String(project.manager) !== String(assignee)) throw badRequest('The assignee must be a member of the project');
}

/** A task's milestone must belong to the same project. */
async function assertMilestoneInProject(projectId: unknown, milestone?: string | null) {
  if (!milestone) return;
  if (!(await Milestone.exists({ _id: milestone, project: projectId }))) throw badRequest('That milestone is not part of this project');
}

projectsRouter.post(
  '/:id/tasks',
  anyProjectRight,
  idParam,
  validate(taskSchema),
  ah(async (req, res) => {
    const p = await projectForCaller(req, req.params.id);
    const manager = canManage(req, p);
    if (!manager && !isMember(req, p)) throw forbidden('Only the project manager and the project team can add tasks');
    if (['completed', 'cancelled'].includes(p.status)) throw conflict(`This project is ${p.status}; reopen it to add tasks`);
    const body = clean(req.body as z.infer<typeof taskSchema>);
    // team members add work for themselves (or leave it unassigned); handing work to others is the manager's call
    if (!manager && body.assignee && String(body.assignee) !== String(req.user!.employeeId)) throw forbidden('You can assign a new task only to yourself; the project manager assigns work to others');
    await assertAssigneeIsMember(p, body.assignee as string | null);
    await assertMilestoneInProject(p._id, body.milestone as string | null);
    const last = await Task.findOne({ project: p._id, status: body.status }).sort({ position: -1 }).select('position').lean();
    const t = await Task.create({
      ...body,
      project: p._id,
      number: await nextNumber(p._id),
      reporter: req.user!.id,
      position: (last?.position ?? -1) + 1,
      completedAt: body.status === 'done' ? now() : undefined,
    });
    if (t.assignee) await tellAssigned(req, t, p);
    await audit({ actor: req.user!.id, action: 'task.create', entity: 'Task', entityId: t._id, meta: { project: p.code, number: t.number, title: t.title } });
    if (!manager) {
      await notify({
        type: 'task.created',
        to: await usersOfEmployees([p.manager]),
        actor: req.user!.id,
        title: `New task in ${p.code}: ${t.title}`,
        body: `Added by ${await employeeName(req.user!.employeeId)}`,
        link: `/projects/${p._id}?task=${t._id}`,
        entity: { kind: 'Task', id: t._id },
      });
    }
    res.status(201).json(taskView(t.toObject() as never, p.code));
  }),
);

/** Loads a task and its project, enforcing that the caller may see the project. */
async function taskForCaller(req: import('express').Request, id: string) {
  const t = await Task.findById(id);
  if (!t) throw notFound('Task');
  const p = await projectForCaller(req, String(t.project));
  return { t, p };
}

projectsRouter.get(
  '/tasks/:id',
  anyProjectRight,
  idParam,
  ah(async (req, res) => {
    const { t, p } = await taskForCaller(req, req.params.id);
    const full = await Task.findById(t._id).populate('assignee', EMP).lean();
    res.json({ ...taskView(full as never, p.code), project: { _id: p._id, code: p.code, name: p.name }, canManage: canManage(req, p), canEdit: canEditTask(req, p, t), isAssignee: String(t.assignee) === String(req.user!.employeeId) });
  }),
);

projectsRouter.put(
  '/tasks/:id',
  anyProjectRight,
  idParam,
  validate(taskSchema),
  ah(async (req, res) => {
    const { t, p } = await taskForCaller(req, req.params.id);
    if (!canEditTask(req, p, t)) throw forbidden('Only the project manager, the assignee or the person who created this task can edit it');
    const body = clean(req.body as z.infer<typeof taskSchema>);
    const next = body.assignee ? String(body.assignee) : '';
    const before = t.assignee ? String(t.assignee) : '';
    // a member may keep the assignee, or pick up an unassigned task themselves; anything else is the manager's call
    if (!canManage(req, p) && next !== before && !(before === '' && next === String(req.user!.employeeId))) throw forbidden('Only the project manager can reassign a task');
    await assertAssigneeIsMember(p, body.assignee as string | null);
    await assertMilestoneInProject(p._id, body.milestone as string | null);
    const wasDone = t.status === 'done';
    const snapshot = { title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, estimateHours: t.estimateHours, assignee: before };
    Object.assign(t, body);
    if (t.status === 'done' && !wasDone) t.completedAt = now();
    if (t.status !== 'done') t.completedAt = undefined;
    await t.save();
    if (t.assignee && String(t.assignee) !== before) await tellAssigned(req, t, p);
    await audit({ actor: req.user!.id, action: 'task.update', entity: 'Task', entityId: t._id, before: snapshot, after: { title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, estimateHours: t.estimateHours, assignee: t.assignee ? String(t.assignee) : '' }, meta: { project: p.code, number: t.number } });
    res.json(taskView(t.toObject() as never, p.code));
  }),
);

/** Move a card: the assignee or a project manager may change the status; dropping at a position reorders the column. */
projectsRouter.post(
  '/tasks/:id/status',
  anyProjectRight,
  idParam,
  validate(taskStatusSchema),
  ah(async (req, res) => {
    const { t, p } = await taskForCaller(req, req.params.id);
    const isAssignee = t.assignee != null && String(t.assignee) === String(req.user!.employeeId);
    if (!isAssignee && !canManage(req, p)) throw forbidden('Only the assignee or the project manager can move this task');
    const { status, position } = req.body as z.infer<typeof taskStatusSchema>;
    const wasDone = t.status === 'done';
    const fromStatus = t.status;
    t.status = status;
    t.completedAt = status === 'done' ? (wasDone ? t.completedAt : now()) : undefined;

    // Re-number the target column so the card sits where it was dropped (or at the bottom)
    const column = await Task.find({ project: p._id, status, _id: { $ne: t._id } }).sort({ position: 1, number: 1 }).select('_id').lean();
    const at = Math.min(position ?? column.length, column.length);
    const order = [...column.map((c) => String(c._id))];
    order.splice(at, 0, String(t._id));
    t.position = at;
    await t.save();
    if (column.length) await Task.bulkWrite(order.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { position: i } } } })).filter((_, i) => order[i] !== String(t._id)));
    if (fromStatus !== status) await audit({ actor: req.user!.id, action: 'task.status', entity: 'Task', entityId: t._id, before: { status: fromStatus }, after: { status }, meta: { project: p.code, number: t.number, title: t.title } });
    res.json(taskView(t.toObject() as never, p.code));
  }),
);

projectsRouter.post(
  '/tasks/:id/comments',
  anyProjectRight,
  idParam,
  validate(taskCommentSchema),
  ah(async (req, res) => {
    const { t, p } = await taskForCaller(req, req.params.id);
    const emp = req.user!.employeeId ? await Employee.findById(req.user!.employeeId).select('name').lean() : null;
    // an atomic push: two people commenting at the same moment must both succeed
    const updated = await Task.findByIdAndUpdate(t._id, { $push: { comments: { by: req.user!.id, byName: emp?.name ?? req.user!.email, text: req.body.text, at: now() } } }, { new: true }).select('comments');
    await notify({
      type: 'task.comment',
      to: [...(await usersOfEmployees([t.assignee])), ...(t.reporter ? [t.reporter] : [])],
      actor: req.user!.id,
      title: `${emp?.name ?? 'Someone'} commented on ${p.code}-${t.number}`,
      body: String(req.body.text).slice(0, 140),
      link: `/projects/${p._id}`,
      entity: { kind: 'Task', id: t._id },
    });
    res.status(201).json(updated!.comments.at(-1));
  }),
);

projectsRouter.delete(
  '/tasks/:id',
  anyProjectRight,
  idParam,
  ah(async (req, res) => {
    const { t, p } = await taskForCaller(req, req.params.id);
    assertManage(req, p);
    await t.deleteOne();
    await removeFilesOfTask(t._id);
    await ProjectDoc.updateMany({ task: t._id }, { $set: { task: null } }); // documents stay with the project
    await audit({ actor: req.user!.id, action: 'task.delete', entity: 'Task', entityId: t._id, before: { project: p.code, number: t.number, title: t.title } });
    res.status(204).end();
  }),
);
