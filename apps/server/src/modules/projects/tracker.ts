import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, PROJECT_DOC_CATEGORIES, PROJECT_STATUS, objectId } from '@cms/shared';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { escapeRegex } from '../../utils/regex';
import { todayStr } from '../../utils/time';
import { AuditLog } from '../audit/model';
import { Milestone } from '../milestones/model';
import { TimeLog } from '../timesheets/model';
import { User } from '../users/model';
import { ProjectDoc } from './documents';
import { Project, Task } from './model';

/**
 * Top-management view across every project: progress (tasks, milestones, hours), every project document with
 * who changed and opened it, and a feed of what happened. Needs projects.view (Admin, Management, HR).
 */
export const trackerRouter = Router();
const view = requirePermission(PERMISSIONS.PROJECTS_VIEW);

const summaryQuery = z.object({ status: z.enum(PROJECT_STATUS).optional(), q: z.string().max(100).optional() });

trackerRouter.get(
  '/tracker/summary',
  view,
  validate(summaryQuery, 'query'),
  ah(async (req, res) => {
    const { status, q } = req.query as z.infer<typeof summaryQuery>;
    const filter: Record<string, unknown> = status ? { status } : { status: { $ne: 'cancelled' } };
    if (q) filter.$or = [{ code: new RegExp(escapeRegex(q), 'i') }, { name: new RegExp(escapeRegex(q), 'i') }];
    const projects = await Project.find(filter).populate('manager', 'name').populate('client', 'name').select('code name status manager client startDate dueDate budgetHours members').sort({ code: 1 }).lean();
    const ids = projects.map((p) => p._id);
    const today = todayStr();
    const [tasks, milestones, docs, hours] = await Promise.all([
      Task.aggregate([
        { $match: { project: { $in: ids } } },
        {
          $group: {
            _id: '$project',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
            inProgress: { $sum: { $cond: [{ $in: ['$status', ['in_progress', 'in_review']] }, 1, 0] } },
            blocked: { $sum: { $cond: [{ $eq: ['$status', 'blocked'] }, 1, 0] } },
            overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'done'] }, { $gt: ['$dueDate', null] }, { $lt: ['$dueDate', today] }] }, 1, 0] } },
            lastUpdate: { $max: '$updatedAt' },
          },
        },
      ]),
      Milestone.aggregate([
        { $match: { project: { $in: ids } } },
        {
          $group: {
            _id: '$project',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
            late: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'done'] }, { $lt: ['$plannedEnd', today] }] }, 1, 0] } },
          },
        },
      ]),
      ProjectDoc.aggregate([{ $match: { project: { $in: ids } } }, { $group: { _id: '$project', count: { $sum: 1 }, versions: { $sum: { $size: '$versions' } }, lastAt: { $max: '$updatedAt' } } }]),
      TimeLog.aggregate([{ $match: { project: { $in: ids } } }, { $group: { _id: '$project', minutes: { $sum: '$minutes' } } }]),
    ]);
    const by = <T extends { _id: unknown }>(rows: T[]) => new Map(rows.map((r) => [String(r._id), r]));
    const T = by(tasks), M = by(milestones), D = by(docs), H = by(hours);
    const items = projects.map((p) => {
      const t = T.get(String(p._id)) as any;
      const m = M.get(String(p._id)) as any;
      const d = D.get(String(p._id)) as any;
      const h = H.get(String(p._id)) as any;
      const total = t?.total ?? 0;
      const lateMilestones = m?.late ?? 0;
      const overdue = t?.overdue ?? 0;
      const pastDue = !!p.dueDate && p.dueDate < today && p.status !== 'completed';
      return {
        _id: p._id,
        code: p.code,
        name: p.name,
        status: p.status,
        manager: (p.manager as any)?.name,
        client: (p.client as any)?.name ?? null,
        startDate: p.startDate,
        dueDate: p.dueDate,
        team: (p.members ?? []).length + 1,
        tasks: { total, done: t?.done ?? 0, inProgress: t?.inProgress ?? 0, blocked: t?.blocked ?? 0, overdue },
        progress: total ? Math.round(((t?.done ?? 0) / total) * 100) : 0,
        milestones: { total: m?.total ?? 0, done: m?.done ?? 0, late: lateMilestones },
        documents: { count: d?.count ?? 0, versions: d?.versions ?? 0, lastAt: d?.lastAt ?? null },
        hoursLogged: Math.round(((h?.minutes ?? 0) / 60) * 10) / 10,
        budgetHours: p.budgetHours ?? null,
        lastActivity: [t?.lastUpdate, d?.lastAt].filter(Boolean).sort().pop() ?? null,
        // a simple traffic light: red when late, amber when work is overdue or blocked
        health: pastDue || lateMilestones ? 'red' : overdue || (t?.blocked ?? 0) ? 'amber' : 'green',
      };
    });
    const totals = {
      projects: items.length,
      atRisk: items.filter((i) => i.health !== 'green').length,
      overdueTasks: items.reduce((s, i) => s + i.tasks.overdue, 0),
      documents: items.reduce((s, i) => s + i.documents.count, 0),
    };
    res.json({ items, totals });
  }),
);

const docsQuery = z.object({
  project: objectId.optional(),
  category: z.enum(PROJECT_DOC_CATEGORIES).optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Every project document, newest change first, with its download count and last download. */
trackerRouter.get(
  '/tracker/documents',
  view,
  validate(docsQuery, 'query'),
  ah(async (req, res) => {
    const f = req.query as unknown as z.infer<typeof docsQuery>;
    const filter: Record<string, unknown> = {};
    if (f.project) filter.project = f.project;
    if (f.category) filter.category = f.category;
    if (f.q) filter.title = new RegExp(escapeRegex(f.q), 'i');
    const [docs, total] = await Promise.all([
      ProjectDoc.find(filter).populate('project', 'code name').sort({ updatedAt: -1 }).skip((f.page - 1) * f.limit).limit(f.limit).lean(),
      ProjectDoc.countDocuments(filter),
    ]);
    const ids = docs.map((d) => String(d._id));
    const downloads = await AuditLog.aggregate([
      { $match: { action: 'project.document.download', 'meta.doc': { $in: ids } } },
      { $group: { _id: '$meta.doc', n: { $sum: 1 }, last: { $max: '$createdAt' }, lastBy: { $last: '$actor' } } },
    ]);
    const users = new Map((await User.find({ _id: { $in: downloads.map((d) => d.lastBy).filter(Boolean) } }).populate('employee', 'name').select('employee email').lean()).map((u) => [String(u._id), (u.employee as any)?.name ?? u.email]));
    const dl = new Map(downloads.map((d) => [String(d._id), d]));
    res.json({
      total,
      page: f.page,
      limit: f.limit,
      items: docs.map((d) => {
        const versions = [...d.versions].sort((a, b) => b.version - a.version);
        const latest = versions[0];
        const x = dl.get(String(d._id));
        return {
          _id: d._id,
          project: d.project,
          title: d.title,
          category: d.category,
          createdByName: d.createdByName,
          createdAt: d.createdAt,
          version: latest?.version ?? 0,
          latest: latest ? { _id: latest._id, name: latest.name, size: latest.size, uploadedByName: latest.uploadedByName, at: latest.at, note: latest.note } : null,
          downloads: x?.n ?? 0,
          lastDownload: x ? { at: x.last, by: users.get(String(x.lastBy)) ?? 'Someone' } : null,
        };
      }),
    });
  }),
);

const ACTIONS = ['project.document.add', 'project.document.version', 'project.document.download', 'project.document.remove', 'task.create', 'task.update', 'task.status', 'task.delete', 'task.file.add', 'task.file.remove'];
const activityQuery = z.object({
  project: z.string().max(30).optional(), // project code
  kind: z.enum(['documents', 'tasks']).optional(),
  limit: z.coerce.number().int().min(1).max(300).default(100),
});

/** What happened on projects lately: documents added, changed, opened; tasks created, edited, moved. */
trackerRouter.get(
  '/tracker/activity',
  view,
  validate(activityQuery, 'query'),
  ah(async (req, res) => {
    const f = req.query as unknown as z.infer<typeof activityQuery>;
    const actions = f.kind === 'documents' ? ACTIONS.filter((a) => a.startsWith('project.document')) : f.kind === 'tasks' ? ACTIONS.filter((a) => a.startsWith('task.')) : ACTIONS;
    const filter: Record<string, unknown> = { action: { $in: actions } };
    if (f.project) filter.$or = [{ 'meta.project': f.project }, { 'before.project': f.project }];
    const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(f.limit).lean();
    const users = new Map((await User.find({ _id: { $in: rows.map((r) => r.actor).filter(Boolean) } }).populate('employee', 'name').select('employee email').lean()).map((u) => [String(u._id), (u.employee as any)?.name ?? u.email]));
    res.json(
      rows.map((r) => {
        const m = (r.meta ?? {}) as Record<string, any>;
        const b = (r.before ?? {}) as Record<string, any>;
        const a = (r.after ?? {}) as Record<string, any>;
        return {
          _id: r._id,
          at: r.createdAt,
          by: users.get(String(r.actor)) ?? 'Someone',
          action: r.action,
          project: m.project ?? b.project ?? null,
          subject: m.title ?? b.title ?? (m.number != null ? `#${m.number}` : ''),
          detail:
            r.action === 'task.status' ? `${b.status} → ${a.status}` : r.action === 'project.document.version' || r.action === 'project.document.download' ? `v${m.version}` : r.action === 'task.file.add' ? m.name : '',
          number: m.number ?? b.number ?? null,
        };
      }),
    );
  }),
);
