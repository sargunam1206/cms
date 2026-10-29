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

// ----- Templates -----
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
