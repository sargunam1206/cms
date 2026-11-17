import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, dateOnly, objectId, salaryComponentSchema, salaryStructureSchema, salaryTemplateSchema, statutorySchema, monthStr } from '@cms/shared';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { conflict, notFound } from '../../utils/errors';
import { todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { exportsRouter } from './exports-routes';
import { fnfRouter } from './fnf-routes';
import { runsRouter } from './runs-routes';
import { Employee } from '../employees/model';
import { setSetting } from '../settings/service';
import { SalaryComponent, SalaryStructure, SalaryTemplate } from './model';
import { STATUTORY_KEY, getStatutory, previewPayslip, validateLines } from './service';

export const payrollRouter = Router();
const P = PERMISSIONS;
const view = requirePermission(P.PAYROLL_VIEW, P.PAYROLL_MANAGE);
const manage = requirePermission(P.PAYROLL_MANAGE);

/** Every read of payroll data is recorded: who looked at what. */
const logRead = (req: { user?: { id: unknown } }, what: string, entityId?: unknown, meta?: unknown) =>
  audit({ actor: req.user!.id as never, action: 'payroll.read', entity: what, entityId, meta });

// ----- Components -----
payrollRouter.get(
  '/components',
  view,
  ah(async (_req, res) => res.json(await SalaryComponent.find().sort({ order: 1, code: 1 }).lean())),
);

payrollRouter.post(
  '/components',
  manage,
  validate(salaryComponentSchema),
  ah(async (req, res) => {
    if (await SalaryComponent.exists({ code: req.body.code })) throw conflict(`Component ${req.body.code} already exists`);
    const { fixedAmount: _f, formula: _g, ...master } = req.body; // values belong to templates/structures
    const c = await SalaryComponent.create(master);
    await audit({ actor: req.user!.id, action: 'payroll.component_create', entity: 'SalaryComponent', entityId: c._id, after: master });
    res.status(201).json(c);
  }),
);

payrollRouter.put(
  '/components/:id',
  manage,
  validate(salaryComponentSchema),
  ah(async (req, res) => {
    const before = await SalaryComponent.findById(req.params.id).lean();
    if (!before) throw notFound('Component');
    const { code: _c, fixedAmount: _f, formula: _g, ...rest } = req.body; // the code is permanent: structures refer to it
    const c = await SalaryComponent.findByIdAndUpdate(req.params.id, rest, { new: true });
    await audit({ actor: req.user!.id, action: 'payroll.component_update', entity: 'SalaryComponent', entityId: req.params.id, before, after: rest });
    res.json(c);
  }),
);

/** A component in use by a template or an employee's salary can't be removed (deactivate it instead). */
payrollRouter.delete(
  '/components/:id',
  manage,
  validate(z.object({ id: objectId }), 'params'),
  ah(async (req, res) => {
    const c = await SalaryComponent.findById(req.params.id).lean();
    if (!c) throw notFound('Component');
    const [templates, structures] = await Promise.all([
      SalaryTemplate.countDocuments({ 'lines.code': c.code }),
      SalaryStructure.countDocuments({ 'lines.code': c.code }),
    ]);
    if (templates || structures) {
      throw conflict(`${c.code} is used in ${templates} template(s) and ${structures} employee salary record(s). Remove it from them first, or mark it inactive instead.`);
    }
    await SalaryComponent.findByIdAndDelete(req.params.id);
    await audit({ actor: req.user!.id, action: 'payroll.component_delete', entity: 'SalaryComponent', entityId: req.params.id, before: c });
    res.json({ ok: true });
  }),
);

// ----- Templates -----
payrollRouter.delete(
  '/templates/:id',
  manage,
  validate(z.object({ id: objectId }), 'params'),
  ah(async (req, res) => {
    const t = await SalaryTemplate.findById(req.params.id).lean();
    if (!t) throw notFound('Template');
    await SalaryTemplate.findByIdAndDelete(req.params.id); // employees keep their own copies of the lines
    await audit({ actor: req.user!.id, action: 'payroll.template_delete', entity: 'SalaryTemplate', entityId: req.params.id, before: t });
    res.json({ ok: true });
  }),
);

payrollRouter.get('/templates', view, ah(async (_req, res) => res.json(await SalaryTemplate.find().sort({ name: 1 }).lean())));

payrollRouter.post(
  '/templates',
  manage,
  validate(salaryTemplateSchema),
  ah(async (req, res) => {
    await validateLines(req.body.lines);
    if (await SalaryTemplate.exists({ name: req.body.name })) throw conflict('A template with that name exists');
    const t = await SalaryTemplate.create(req.body);
    await audit({ actor: req.user!.id, action: 'payroll.template_create', entity: 'SalaryTemplate', entityId: t._id, after: req.body });
    res.status(201).json(t);
  }),
);

payrollRouter.put(
  '/templates/:id',
  manage,
  validate(salaryTemplateSchema),
  ah(async (req, res) => {
    await validateLines(req.body.lines);
    const before = await SalaryTemplate.findById(req.params.id).lean();
    if (!before) throw notFound('Template');
    const t = await SalaryTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await audit({ actor: req.user!.id, action: 'payroll.template_update', entity: 'SalaryTemplate', entityId: req.params.id, before, after: req.body });
    res.json(t); // existing employee structures keep their own copy of the lines
  }),
);

/** Copy a template's current lines onto every employee whose latest salary structure was started from it. */
payrollRouter.post(
  '/templates/:id/apply',
  manage,
  validate(z.object({ id: objectId }), 'params'),
  validate(z.object({ effectiveFrom: dateOnly })),
  ah(async (req, res) => {
    const t = await SalaryTemplate.findById(req.params.id).lean();
    if (!t) throw notFound('Template');
    await validateLines(t.lines as never);
    const used = await SalaryStructure.distinct('employee', { template: t._id });
    let updated = 0;
    for (const emp of used) {
      const latest = await SalaryStructure.findOne({ employee: emp }).sort({ effectiveFrom: -1 }).lean();
      if (!latest || String(latest.template) !== String(t._id)) continue; // later changed to something else; leave it
      await SalaryStructure.findOneAndUpdate(
        { employee: emp, effectiveFrom: req.body.effectiveFrom },
        { employee: emp, effectiveFrom: req.body.effectiveFrom, template: t._id, lines: t.lines, createdBy: req.user!.id },
        { upsert: true },
      );
      updated++;
    }
    await audit({ actor: req.user!.id, action: 'payroll.template_apply', entity: 'SalaryTemplate', entityId: req.params.id, meta: { employees: updated, effectiveFrom: req.body.effectiveFrom } });
    res.json({ updated });
  }),
);

/** Start several employees on a template at once: each gets their own copy of its lines from the given date. */
payrollRouter.post(
  '/templates/:id/assign',
  manage,
  validate(z.object({ id: objectId }), 'params'),
  validate(z.object({ employeeIds: z.array(objectId).min(1).max(500), effectiveFrom: dateOnly })),
  ah(async (req, res) => {
    const t = await SalaryTemplate.findById(req.params.id).lean();
    if (!t) throw notFound('Template');
    await validateLines(t.lines as never);
    const ids: string[] = [...new Set<string>(req.body.employeeIds)];
    const found = await Employee.find({ _id: { $in: ids } }).select('_id').lean();
    for (const e of found) {
      await SalaryStructure.findOneAndUpdate(
        { employee: e._id, effectiveFrom: req.body.effectiveFrom },
        { employee: e._id, effectiveFrom: req.body.effectiveFrom, template: t._id, lines: t.lines, createdBy: req.user!.id },
        { upsert: true },
      );
    }
    await audit({ actor: req.user!.id, action: 'payroll.template_assign', entity: 'SalaryTemplate', entityId: req.params.id, meta: { employees: found.length, effectiveFrom: req.body.effectiveFrom } });
    res.json({ updated: found.length });
  }),
);

// ----- Employee salary structures (effective-dated) -----
payrollRouter.get(
  '/structures/:employeeId',
  view,
  validate(z.object({ employeeId: objectId }), 'params'),
  ah(async (req, res) => {
    await logRead(req, 'SalaryStructure', req.params.employeeId);
    res.json(await SalaryStructure.find({ employee: req.params.employeeId }).sort({ effectiveFrom: -1 }).lean());
  }),
);

payrollRouter.post(
  '/structures/:employeeId',
  manage,
  validate(z.object({ employeeId: objectId }), 'params'),
  validate(salaryStructureSchema),
  ah(async (req, res) => {
    if (!(await Employee.exists({ _id: req.params.employeeId }))) throw notFound('Employee');
    await validateLines(req.body.lines);
    const before = await SalaryStructure.findOne({ employee: req.params.employeeId, effectiveFrom: { $lte: req.body.effectiveFrom } }).sort({ effectiveFrom: -1 }).lean();
    // Re-saving the same effective date replaces that revision; a new date adds a revision
    const doc = await SalaryStructure.findOneAndUpdate(
      { employee: req.params.employeeId, effectiveFrom: req.body.effectiveFrom },
      { ...req.body, employee: req.params.employeeId, createdBy: req.user!.id },
      { upsert: true, new: true },
    );
    await audit({ actor: req.user!.id, action: 'payroll.structure_set', entity: 'SalaryStructure', entityId: doc._id, before: before?.lines, after: req.body, meta: { employee: req.params.employeeId } });
    res.status(201).json(doc);
  }),
);

// ----- Statutory settings -----
payrollRouter.get(
  '/statutory',
  view,
  ah(async (_req, res) => res.json(await getStatutory(todayStr()))),
);

payrollRouter.put(
  '/statutory',
  manage,
  validate(z.object({ value: statutorySchema, effectiveFrom: dateOnly.optional() })),
  ah(async (req, res) => {
    const { value, effectiveFrom = todayStr() } = req.body;
    await setSetting(STATUTORY_KEY, value, effectiveFrom, req.user!.id);
    res.json(await getStatutory(todayStr()));
  }),
);

// ----- Preview: what an employee would be paid, from live data; nothing is saved -----
payrollRouter.get(
  '/preview/:employeeId',
  view,
  validate(z.object({ employeeId: objectId }), 'params'),
  validate(z.object({ month: monthStr }), 'query'),
  ah(async (req, res) => {
    const month = (req.query as { month: string }).month;
    await logRead(req, 'Payslip', req.params.employeeId, { month, preview: true });
    res.json(await previewPayslip(req.params.employeeId, month));
  }),
);

payrollRouter.use(exportsRouter);
payrollRouter.use(fnfRouter);
payrollRouter.use(runsRouter);
