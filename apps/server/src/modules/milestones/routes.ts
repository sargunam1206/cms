import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS, baselineSchema, milestoneSchema, objectId } from '@cms/shared';
import { hasPermission, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { now, todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { canManage, projectForCaller } from '../projects/access';
import { Project, Task } from '../projects/model';
import { Milestone } from './model';
import { milestoneState, progressOf } from './service';

export const milestonesRouter = Router();
const P = PERMISSIONS;
const idParam = validate(z.object({ id: objectId }), 'params');
const anyRight = requirePermission(P.TASKS_SELF, P.PROJECTS_VIEW, P.ESTIMATES_MANAGE);

const canEdit = (req: Request, project: any) => hasPermission(req, P.ESTIMATES_MANAGE) && canManage(req, project);
const blankToNull = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as T;

async function assertOwner(project: any, owner?: string | null) {
  if (!owner) return;
  const ok = String(project.manager) === owner || project.members.some((m: unknown) => String(m) === owner);
  if (!ok) throw badRequest('The owner must be a member of the project');
}

/** Milestones with where they stand today. */
async function describe(list: any[], today = todayStr()) {
  const prog = await progressOf(list.map((m) => m._id));
  return list.map((m) => {
    const t = prog.get(String(m._id));
    const { state, slipDays } = milestoneState(m, t ? t.done / t.total : null, today);
    return { ...m, state, slipDays, tasks: t?.total ?? 0, tasksDone: t?.done ?? 0 };
  });
}

milestonesRouter.get(
  '/project/:id',
  anyRight,
  idParam,
  ah(async (req, res) => {
    const project = await projectForCaller(req, req.params.id);
    const list = await Milestone.find({ project: project._id }).populate('owner', 'name code').sort({ plannedStart: 1, plannedEnd: 1 }).lean();
    // Tasks with a due date, shown under their milestone on the timeline
    const tasks = await Task.find({ project: project._id, milestone: { $ne: null } }).select('number title status dueDate milestone assignee').populate('assignee', 'name').lean();
    res.json({
      canEdit: canEdit(req, project),
      baselineAt: project.baselineAt ?? null,
      today: todayStr(),
      project: { _id: project._id, code: project.code, name: project.name, startDate: project.startDate, dueDate: project.dueDate },
      items: await describe(list),
      tasks: tasks.map((t) => ({ ...t, ref: `${project.code}-${t.number}` })),
    });
  }),
);

milestonesRouter.post(
  '/project/:id',
  requirePermission(P.ESTIMATES_MANAGE),
  idParam,
  validate(milestoneSchema),
  ah(async (req, res) => {
    const project = await projectForCaller(req, req.params.id);
    if (!canEdit(req, project)) throw forbidden('Only the project manager can do that');
    if (['completed', 'cancelled'].includes(project.status)) throw conflict(`This project is ${project.status}`);
    const body = blankToNull(req.body);
    await assertOwner(project, body.owner as string | null);
    const m = await Milestone.create({ ...body, project: project._id, doneOn: body.status === 'done' ? todayStr() : undefined, order: await Milestone.countDocuments({ project: project._id }) });
    await audit({ actor: req.user!.id, action: 'milestone.create', entity: 'Milestone', entityId: m._id, meta: { project: project.code, name: m.name, plannedStart: m.plannedStart, plannedEnd: m.plannedEnd } });
    res.status(201).json(m);
  }),
);

async function milestoneForCaller(req: Request, id: string) {
  const m = await Milestone.findById(id);
  if (!m) throw notFound('Milestone');
  const project = await projectForCaller(req, String(m.project));
  if (!canEdit(req, project)) throw forbidden('Only the project manager can do that');
  return { m, project };
}

milestonesRouter.put(
  '/:id',
  requirePermission(P.ESTIMATES_MANAGE),
  idParam,
  validate(milestoneSchema),
  ah(async (req, res) => {
    const { m, project } = await milestoneForCaller(req, req.params.id);
    const body = blankToNull(req.body);
    await assertOwner(project, body.owner as string | null);
    const before = { plannedStart: m.plannedStart, plannedEnd: m.plannedEnd, status: m.status };
    const wasDone = m.status === 'done';
    m.set(body);
    if (m.status === 'done' && !wasDone) m.doneOn = todayStr();
    if (m.status !== 'done') m.doneOn = undefined;
    await m.save();
    await audit({ actor: req.user!.id, action: 'milestone.update', entity: 'Milestone', entityId: m._id, before, after: { plannedStart: m.plannedStart, plannedEnd: m.plannedEnd, status: m.status }, meta: { project: project.code, name: m.name } });
    res.json(m);
  }),
);

milestonesRouter.delete(
  '/:id',
  requirePermission(P.ESTIMATES_MANAGE),
  idParam,
  ah(async (req, res) => {
    const { m, project } = await milestoneForCaller(req, req.params.id);
    await Task.updateMany({ milestone: m._id }, { milestone: null }); // the tasks stay, just unlinked
    await m.deleteOne();
    await audit({ actor: req.user!.id, action: 'milestone.delete', entity: 'Milestone', entityId: m._id, meta: { project: project.code, name: m.name } });
    res.json({ ok: true });
  }),
);

/** Freeze the current plan as the baseline that slip is measured against. */
milestonesRouter.post(
  '/project/:id/baseline',
  requirePermission(P.ESTIMATES_MANAGE),
  idParam,
  validate(baselineSchema),
  ah(async (req, res) => {
    const project = await projectForCaller(req, req.params.id);
    if (!canEdit(req, project)) throw forbidden('Only the project manager can do that');
    const list = await Milestone.find({ project: project._id });
    if (!list.length) throw badRequest('Add milestones before setting a baseline');
    if (project.baselineAt && !req.body.reason) throw badRequest('A baseline already exists; say why it is being reset');
    await Milestone.updateMany({ project: project._id }, [{ $set: { baselineStart: '$plannedStart', baselineEnd: '$plannedEnd' } }]);
    await Project.updateOne({ _id: project._id }, { baselineAt: now() });
    await audit({ actor: req.user!.id, action: project.baselineAt ? 'milestone.rebaseline' : 'milestone.baseline', entity: 'Project', entityId: project._id, meta: { project: project.code, milestones: list.length, reason: req.body.reason } });
    res.json({ ok: true, milestones: list.length });
  }),
);

/** Every open project's milestones, for Management and HR. */
milestonesRouter.get(
  '/portfolio',
  requirePermission(P.PROJECTS_VIEW),
  ah(async (_req, res) => {
    const projects = await Project.find({ status: { $in: ['planning', 'active', 'on_hold'] } }).select('code name status manager baselineAt').populate('manager', 'name').sort({ code: 1 }).lean();
    const list = await Milestone.find({ project: { $in: projects.map((p) => p._id) } }).populate('owner', 'name').sort({ plannedStart: 1 }).lean();
    const items = await describe(list);
    const byProject = new Map<string, typeof items>();
    for (const m of items) byProject.set(String(m.project), [...(byProject.get(String(m.project)) ?? []), m]);
    res.json({
      today: todayStr(),
      projects: projects.map((p) => {
        const ms = byProject.get(String(p._id)) ?? [];
        const worst = ms.some((m) => m.state === 'late') ? 'late' : ms.some((m) => m.state === 'at_risk') ? 'at_risk' : 'ok';
        return { ...p, health: worst, milestones: ms };
      }),
    });
  }),
);
