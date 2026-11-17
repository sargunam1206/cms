import ExcelJS from 'exceljs';
import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS, estimateCreateSchema, estimateDecisionSchema, estimateSaveSchema, objectId, rateCardSaveSchema, varianceSettingsSchema } from '@cms/shared';
import { hasPermission, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { now } from '../../utils/time';
import { audit } from '../audit/model';
import { notify, usersOfEmployees, usersWithPermission } from '../notifications/service';
import { canManage, projectForCaller } from '../projects/access';
import { Project } from '../projects/model';
import { setSetting } from '../settings/service';
import { Estimate } from './model';
import { projectVariance, varianceReport } from './variance';
import { RATE_CARD_KEY, VARIANCE_KEY, compareLines, getRateCard, getVariance, priceLines } from './service';

export const estimatesRouter = Router();
const P = PERMISSIONS;
const idParam = validate(z.object({ id: objectId }), 'params');
const anyRight = requirePermission(P.TASKS_SELF, P.ESTIMATES_VIEW, P.ESTIMATES_MANAGE);

/** Cost and rates are for people with estimates.view; everyone else sees hours only. */
const money = (req: Request) => hasPermission(req, P.ESTIMATES_VIEW);
function present(req: Request, e: any, withLines = true) {
  const o = typeof e.toObject === 'function' ? e.toObject() : e;
  const withMoney = money(req);
  const lines = (o.lines ?? []).map((l: any) => (withMoney ? l : { _id: l._id, module: l.module, task: l.task, role: l.role, hours: l.hours, note: l.note }));
  const base = { ...o, lines: withLines ? lines : undefined, lineCount: lines.length };
  if (!withMoney) {
    delete base.totalCost;
    delete base.totalBilling;
  }
  return base;
}

/** Edits estimates of this project: estimates.manage, on a project the caller leads (or any, with projects.view). */
const canEdit = (req: Request, project: any) => hasPermission(req, P.ESTIMATES_MANAGE) && canManage(req, project);

/** Everyone outside the money and editing groups only sees what has been approved. */
const seesDrafts = (req: Request, project: any) => money(req) || canEdit(req, project);

async function loadEstimate(req: Request, id: string) {
  const e = await Estimate.findById(id);
  if (!e) throw notFound('Estimate');
  const project = await projectForCaller(req, String(e.project));
  if (!seesDrafts(req, project) && !['approved', 'superseded'].includes(e.status)) throw notFound('Estimate');
  return { e, project };
}

// ===================== Rate card =====================
estimatesRouter.get(
  '/rate-card',
  requirePermission(P.ESTIMATES_VIEW),
  ah(async (_req, res) => res.json({ ...(await getRateCard()), variance: await getVariance() })),
);

estimatesRouter.put(
  '/rate-card',
  requirePermission(P.ESTIMATES_APPROVE),
  validate(rateCardSaveSchema),
  ah(async (req, res) => {
    const { effectiveFrom, roles } = req.body;
    await setSetting(RATE_CARD_KEY, { roles }, effectiveFrom, req.user!.id as never);
    res.json({ roles, effectiveFrom });
  }),
);

estimatesRouter.put(
  '/variance',
  requirePermission(P.ESTIMATES_APPROVE),
  validate(varianceSettingsSchema.refine((v) => v.alertPct >= v.warnPct, 'The alert level must not be below the warning level')),
  ah(async (req, res) => {
    await setSetting(VARIANCE_KEY, req.body, '1970-01-01', req.user!.id as never);
    res.json(req.body);
  }),
);

/** Role names for pickers; no rates. */
estimatesRouter.get('/roles', anyRight, ah(async (_req, res) => res.json((await getRateCard()).roles.map((r) => r.role))));

// ===================== Estimated vs actual =====================
/** Hours, and cost when the caller may see it, for one project against its approved estimate. */
estimatesRouter.get(
  '/project/:id/variance',
  anyRight,
  idParam,
  ah(async (req, res) => {
    const project = await projectForCaller(req, req.params.id);
    if (!money(req) && !canEdit(req, project)) throw forbidden('Only the project manager and people who see costs can open this');
    const v = await projectVariance(project._id);
    if (!v) return res.json({ hasEstimate: false });
    if (money(req)) return res.json({ hasEstimate: true, canSeeMoney: true, ...v });
    // Hours only: drop every money figure and judge by hours
    const { estimate, actual, byRole, byPerson, costOverPct: _c, flag: _f, ...rest } = v;
    void _c;
    void _f;
    res.json({
      hasEstimate: true,
      canSeeMoney: false,
      ...rest,
      flag: v.hoursFlag,
      estimate: { _id: estimate._id, version: estimate.version, totalHours: estimate.totalHours, approvedAt: estimate.approvedAt },
      actual: { hours: actual.hours },
      byRole: byRole.map(({ estCost: _a, actCost: _b, ...r }) => r),
      byPerson: byPerson.map(({ cost: _d, ...p }) => p),
    });
  }),
);

/** Module names of the approved estimate, for tagging tasks. */
estimatesRouter.get(
  '/project/:id/modules',
  anyRight,
  idParam,
  ah(async (req, res) => {
    const project = await projectForCaller(req, req.params.id);
    const e = await Estimate.findOne({ project: project._id, status: 'approved' }).select('lines.module').lean();
    res.json([...new Set((e?.lines ?? []).map((l) => l.module))]);
  }),
);

/** Every project with an approved estimate; ?format=xlsx downloads it as a spreadsheet. */
estimatesRouter.get(
  '/report',
  requirePermission(P.ESTIMATES_VIEW),
  validate(z.object({ format: z.enum(['json', 'xlsx']).optional() }), 'query'),
  ah(async (req, res) => {
    const rows = await varianceReport();
    if ((req.query as { format?: string }).format !== 'xlsx') return res.json(rows);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Estimated vs actual');
    ws.columns = [
      { header: 'Project', key: 'code', width: 14 },
      { header: 'Name', key: 'name', width: 32 },
      { header: 'Manager', key: 'manager', width: 22 },
      { header: 'Estimate', key: 'version', width: 10 },
      { header: 'Estimated hours', key: 'estHours', width: 16 },
      { header: 'Actual hours', key: 'actHours', width: 14 },
      { header: 'Hours over %', key: 'hoursOver', width: 14 },
      { header: 'Estimated cost (Rs)', key: 'estCost', width: 20 },
      { header: 'Actual cost (Rs)', key: 'actCost', width: 18 },
      { header: 'Cost over %', key: 'costOver', width: 13 },
      { header: 'Status', key: 'flag', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    for (const r of rows)
      ws.addRow({ code: r.project.code, name: r.project.name, manager: r.project.manager, version: `v${r.version}`, estHours: r.estHours, actHours: r.actHours, hoursOver: r.hoursOverPct, estCost: r.estCost / 100, actCost: r.actCost / 100, costOver: r.costOverPct, flag: { ok: 'OK', warn: 'Amber', alert: 'Red', none: '' }[r.flag] });
    for (const k of ['estCost', 'actCost']) ws.getColumn(k).numFmt = '#,##0.00';
    await audit({ actor: req.user!.id, action: 'estimate.report.export', entity: 'Estimate', meta: { rows: rows.length } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="estimated-vs-actual.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }),
);

// ===================== Versions of a project's estimate =====================
estimatesRouter.get(
  '/project/:id',
  anyRight,
  idParam,
  ah(async (req, res) => {
    const project = await projectForCaller(req, req.params.id);
    const filter: Record<string, unknown> = { project: project._id };
    if (!seesDrafts(req, project)) filter.status = { $in: ['approved', 'superseded'] };
    const list = await Estimate.find(filter).sort({ version: -1 }).lean();
    res.json({ canEdit: canEdit(req, project), canSeeMoney: money(req), items: list.map((e) => present(req, e, false)) });
  }),
);

estimatesRouter.post(
  '/project/:id',
  requirePermission(P.ESTIMATES_MANAGE),
  idParam,
  validate(estimateCreateSchema),
  ah(async (req, res) => {
    const project = await projectForCaller(req, req.params.id);
    if (!canEdit(req, project)) throw forbidden('Only the project manager can do that');
    if (['completed', 'cancelled'].includes(project.status)) throw conflict(`Project ${project.code} is ${project.status}`);
    if (await Estimate.exists({ project: project._id, status: { $in: ['draft', 'submitted', 'rejected'] } })) throw conflict('Finish or discard the estimate that is already open first');
    let lines: { module: string; task: string; role: string; hours: number; note?: string | null }[] = [];
    let note: string | undefined;
    if (req.body.copyFrom) {
      const from = await Estimate.findOne({ _id: req.body.copyFrom, project: project._id }).lean();
      if (!from) throw notFound('Estimate to copy');
      lines = from.lines.map((l) => ({ module: l.module, task: l.task, role: l.role, hours: l.hours, note: l.note }));
      note = from.note ?? undefined;
    }
    const last = await Estimate.findOne({ project: project._id }).sort({ version: -1 }).select('version').lean();
    const priced = lines.length ? await priceLines(lines.map((l) => ({ ...l, note: l.note ?? undefined }))) : { lines: [], totalHours: 0, totalCost: 0, totalBilling: 0 };
    const e = await Estimate.create({ project: project._id, version: (last?.version ?? 0) + 1, status: 'draft', note, ...priced, createdBy: req.user!.id });
    await audit({ actor: req.user!.id, action: 'estimate.create', entity: 'Estimate', entityId: e._id, meta: { project: project.code, version: e.version, copyFrom: req.body.copyFrom } });
    res.status(201).json(present(req, e));
  }),
);

estimatesRouter.get(
  '/:id',
  anyRight,
  idParam,
  ah(async (req, res) => {
    const { e, project } = await loadEstimate(req, req.params.id);
    res.json({ ...present(req, e), canEdit: canEdit(req, project), canSeeMoney: money(req), project: { _id: project._id, code: project.code, name: project.name } });
  }),
);

/** Replace the lines of a draft (or of one that was sent back). */
estimatesRouter.put(
  '/:id',
  requirePermission(P.ESTIMATES_MANAGE),
  idParam,
  validate(estimateSaveSchema),
  ah(async (req, res) => {
    const { e, project } = await loadEstimate(req, req.params.id);
    if (!canEdit(req, project)) throw forbidden('Only the project manager can do that');
    if (!['draft', 'rejected'].includes(e.status)) throw conflict(`An estimate that is ${e.status} cannot be edited; start a new version instead`);
    const priced = await priceLines(req.body.lines);
    e.set({ ...priced, note: req.body.note || undefined, status: 'draft', decidedBy: undefined, decidedAt: undefined });
    await e.save();
    await audit({ actor: req.user!.id, action: 'estimate.update', entity: 'Estimate', entityId: e._id, meta: { project: project.code, version: e.version, lines: priced.lines.length, hours: priced.totalHours } });
    res.json(present(req, e));
  }),
);

estimatesRouter.delete(
  '/:id',
  requirePermission(P.ESTIMATES_MANAGE),
  idParam,
  ah(async (req, res) => {
    const { e, project } = await loadEstimate(req, req.params.id);
    if (!canEdit(req, project)) throw forbidden('Only the project manager can do that');
    if (!['draft', 'rejected'].includes(e.status)) throw conflict('Only a draft can be discarded');
    await e.deleteOne();
    await audit({ actor: req.user!.id, action: 'estimate.discard', entity: 'Estimate', entityId: e._id, meta: { project: project.code, version: e.version } });
    res.json({ ok: true });
  }),
);

estimatesRouter.post(
  '/:id/submit',
  requirePermission(P.ESTIMATES_MANAGE),
  idParam,
  ah(async (req, res) => {
    const { e, project } = await loadEstimate(req, req.params.id);
    if (!canEdit(req, project)) throw forbidden('Only the project manager can do that');
    if (e.status !== 'draft') throw conflict(`This estimate is ${e.status}`);
    if (!e.lines.length) throw badRequest('Add at least one line before submitting');
    e.set({ status: 'submitted', submittedBy: req.user!.id, submittedAt: now(), decidedBy: undefined, decidedAt: undefined, decisionComment: undefined });
    await e.save();
    await audit({ actor: req.user!.id, action: 'estimate.submit', entity: 'Estimate', entityId: e._id, meta: { project: project.code, version: e.version, hours: e.totalHours } });
    await notify({ type: 'estimate.submitted', to: await usersWithPermission(P.ESTIMATES_APPROVE), actor: req.user!.id, title: `Estimate v${e.version} for ${project.code} is waiting for approval`, body: `${e.totalHours} h`, link: `/projects/${project._id}?tab=estimate`, entity: { kind: 'Estimate', id: e._id } });
    res.json(present(req, e));
  }),
);

estimatesRouter.post(
  '/:id/decision',
  requirePermission(P.ESTIMATES_APPROVE),
  idParam,
  validate(estimateDecisionSchema),
  ah(async (req, res) => {
    const { e, project } = await loadEstimate(req, req.params.id);
    const { decision, comment } = req.body as { decision: 'approved' | 'rejected'; comment?: string };
    if (e.status !== 'submitted') throw conflict(`This estimate is ${e.status}`);
    if (String(e.submittedBy) === String(req.user!.id)) throw forbidden('You cannot decide an estimate you submitted yourself');
    if (decision === 'rejected' && !comment) throw badRequest('Say what needs to change');
    e.set({ status: decision, decidedBy: req.user!.id, decidedAt: now(), decisionComment: comment || undefined });
    await e.save();
    if (decision === 'approved') {
      // The newest approval replaces the earlier one and becomes the project's hour budget
      await Estimate.updateMany({ project: project._id, status: 'approved', _id: { $ne: e._id } }, { status: 'superseded' });
      await Project.updateOne({ _id: project._id }, { budgetHours: e.totalHours });
    }
    await audit({ actor: req.user!.id, action: `estimate.${decision === 'approved' ? 'approve' : 'reject'}`, entity: 'Estimate', entityId: e._id, meta: { project: project.code, version: e.version, comment } });
    // The person who submitted it, and the project's manager
    const to = [...new Set([...(e.submittedBy ? [String(e.submittedBy)] : []), ...(await usersOfEmployees([project.manager])).map(String)])];
    await notify({ type: 'estimate.decided', to: to as never, actor: req.user!.id, title: `Estimate v${e.version} for ${project.code} was ${decision === 'approved' ? 'approved' : 'sent back'}`, body: comment, link: `/projects/${project._id}?tab=estimate`, entity: { kind: 'Estimate', id: e._id } });
    res.json(present(req, e));
  }),
);

/** Line-by-line difference from another version of the same project (default: the one before). */
estimatesRouter.get(
  '/:id/compare',
  anyRight,
  idParam,
  validate(z.object({ with: objectId.optional() }), 'query'),
  ah(async (req, res) => {
    const { e, project } = await loadEstimate(req, req.params.id);
    const otherId = (req.query as { with?: string }).with;
    const other = otherId
      ? await Estimate.findOne({ _id: otherId, project: project._id })
      : await Estimate.findOne({ project: project._id, version: { $lt: e.version } }).sort({ version: -1 });
    if (!other || (!seesDrafts(req, project) && !['approved', 'superseded'].includes(other.status))) throw notFound('Estimate to compare with');
    const withMoney = money(req);
    const slim = (x: typeof e) => ({ _id: x._id, version: x.version, status: x.status, totalHours: x.totalHours, ...(withMoney ? { totalCost: x.totalCost } : {}) });
    const strip = <T extends { costRate?: number; billingRate?: number }>(l: T) => (withMoney ? l : { ...l, costRate: undefined, billingRate: undefined });
    const diff = compareLines(other.toObject().lines, e.toObject().lines); // plain objects: spreading Mongoose subdocuments loses their fields
    res.json({ from: slim(other), to: slim(e), added: diff.added.map(strip), removed: diff.removed.map(strip), changed: diff.changed.map(strip) });
  }),
);
