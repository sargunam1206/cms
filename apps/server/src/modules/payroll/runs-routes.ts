import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, monthStr, objectId } from '@cms/shared';
import { authenticate, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, notFound } from '../../utils/errors';
import { audit } from '../audit/model';
import { Employee } from '../employees/model';
import { setSetting } from '../settings/service';
import { emailRunPayslips } from './email-payslips';
import { Loan, OneTimeItem, Payslip, PayrollRun } from './model';
import { toPaise } from './money';
import { payslipLayout } from './service';
import { WORKFLOW_KEY, approveRun, assertMonthOpenForAdjustments, computeRun, createRun, deleteRun, getRun, getWorkflow, rejectRun, reopenRun, submitRun } from './runs';

export const runsRouter = Router();
const P = PERMISSIONS;
const view = requirePermission(P.PAYROLL_VIEW, P.PAYROLL_MANAGE);
const manage = requirePermission(P.PAYROLL_MANAGE);
const approve = requirePermission(P.PAYROLL_APPROVE);

/** Every read of payroll data is recorded: who looked at what. */
const logRead = (req: { user?: { id: unknown } }, what: string, entityId?: unknown, meta?: unknown) =>
  audit({ actor: req.user!.id as never, action: 'payroll.read', entity: what, entityId, meta });

// ===== One-time items =====
const oneTimeSchema = z.object({
  employee: objectId,
  month: monthStr,
  kind: z.enum(['earning', 'deduction']),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/, 'Capitals, digits and _'),
  name: z.string().min(2).max(60),
  amount: z.number().positive().max(100_000_000), // rupees
  taxable: z.boolean().default(true),
  note: z.string().max(200).optional(),
});

runsRouter.get(
  '/one-time',
  view,
  validate(z.object({ month: monthStr }), 'query'),
  ah(async (req, res) => {
    const month = (req.query as { month: string }).month;
    await logRead(req, 'OneTimeItem', undefined, { month });
    res.json(await OneTimeItem.find({ month }).populate('employee', 'name code').sort({ createdAt: 1 }).lean());
  }),
);

runsRouter.post(
  '/one-time',
  manage,
  validate(oneTimeSchema),
  ah(async (req, res) => {
    if (!(await Employee.exists({ _id: req.body.employee }))) throw notFound('Employee');
    await assertMonthOpenForAdjustments(req.body.month);
    const item = await OneTimeItem.create({ ...req.body, amount: toPaise(req.body.amount), createdBy: req.user!.id });
    await audit({ actor: req.user!.id, action: 'payroll.one_time_add', entity: 'OneTimeItem', entityId: item._id, after: req.body });
    res.status(201).json(item);
  }),
);

runsRouter.delete(
  '/one-time/:id',
  manage,
  validate(z.object({ id: objectId }), 'params'),
  ah(async (req, res) => {
    const item = await OneTimeItem.findById(req.params.id);
    if (!item) throw notFound('Item');
    await assertMonthOpenForAdjustments(item.month);
    await item.deleteOne();
    await audit({ actor: req.user!.id, action: 'payroll.one_time_remove', entity: 'OneTimeItem', entityId: item._id, before: item.toObject() });
    res.status(204).end();
  }),
);

// ===== Loans =====
const loanBody = z.object({
  employee: objectId,
  principal: z.number().positive().max(100_000_000), // rupees
  emi: z.number().positive().max(100_000_000),
  startMonth: monthStr,
  note: z.string().max(200).optional(),
});

runsRouter.get(
  '/loans',
  view,
  validate(z.object({ employee: objectId.optional(), status: z.enum(['active', 'closed']).optional() }), 'query'),
  ah(async (req, res) => {
    const filter = req.query as Record<string, unknown>;
    await logRead(req, 'Loan', undefined, filter);
    res.json(await Loan.find(filter).populate('employee', 'name code').sort({ createdAt: -1 }).lean());
  }),
);

runsRouter.post(
  '/loans',
  manage,
  validate(loanBody),
  ah(async (req, res) => {
    if (!(await Employee.exists({ _id: req.body.employee }))) throw notFound('Employee');
    if (req.body.emi > req.body.principal) throw badRequest('EMI cannot exceed the loan amount');
    const principal = toPaise(req.body.principal);
    const loan = await Loan.create({ ...req.body, principal, emi: toPaise(req.body.emi), balance: principal, createdBy: req.user!.id });
    await audit({ actor: req.user!.id, action: 'payroll.loan_create', entity: 'Loan', entityId: loan._id, after: req.body });
    res.status(201).json(loan);
  }),
);

runsRouter.post(
  '/loans/:id/close',
  manage,
  validate(z.object({ id: objectId }), 'params'),
  ah(async (req, res) => {
    const loan = await Loan.findById(req.params.id);
    if (!loan) throw notFound('Loan');
    const before = { status: loan.status, balance: loan.balance };
    loan.status = 'closed';
    await loan.save();
    await audit({ actor: req.user!.id, action: 'payroll.loan_close', entity: 'Loan', entityId: loan._id, before });
    res.json(loan);
  }),
);

// ===== Approval chain setting =====
runsRouter.get('/workflow', view, ah(async (_req, res) => res.json(await getWorkflow())));
runsRouter.put(
  '/workflow',
  manage,
  validate(z.object({ managementApproval: z.boolean() })),
  ah(async (req, res) => {
    await setSetting(WORKFLOW_KEY, req.body, '1970-01-01', req.user!.id);
    res.json(await getWorkflow());
  }),
);

// ===== Runs =====
const byId = validate(z.object({ id: objectId }), 'params');

runsRouter.get(
  '/runs',
  view,
  ah(async (req, res) => {
    await logRead(req, 'PayrollRun');
    res.json(await PayrollRun.find().sort({ month: -1 }).limit(60).lean());
  }),
);

runsRouter.post('/runs', manage, validate(z.object({ month: monthStr })), ah(async (req, res) => res.status(201).json(await createRun(req.body.month, req.user!.id))));

runsRouter.get(
  '/runs/:id',
  view,
  byId,
  ah(async (req, res) => {
    const run = await getRun(req.params.id);
    await logRead(req, 'PayrollRun', run._id, { month: run.month });
    const payslips = await Payslip.find({ run: run._id }).select('employee person attendance gross totalDeductions net warnings').sort({ 'person.code': 1 }).lean();
    res.json({ run, payslips });
  }),
);

runsRouter.post('/runs/:id/compute', manage, byId, ah(async (req, res) => res.json(await computeRun(req.params.id, req.user!.id))));
runsRouter.post('/runs/:id/submit', manage, byId, ah(async (req, res) => res.json(await submitRun(req.params.id, req.user!))));
runsRouter.post('/runs/:id/approve', approve, byId, ah(async (req, res) => res.json(await approveRun(req.params.id, req.user!))));
runsRouter.post(
  '/runs/:id/reject',
  approve,
  byId,
  validate(z.object({ comment: z.string().min(3).max(500) })),
  ah(async (req, res) => res.json(await rejectRun(req.params.id, req.user!, req.body.comment))),
);
runsRouter.post(
  '/runs/:id/reopen',
  manage,
  byId,
  validate(z.object({ reason: z.string().min(5).max(500) })),
  ah(async (req, res) => res.json(await reopenRun(req.params.id, req.user!, req.body.reason))),
);
runsRouter.delete(
  '/runs/:id',
  manage,
  byId,
  ah(async (req, res) => {
    await deleteRun(req.params.id, req.user!.id);
    res.status(204).end();
  }),
);

runsRouter.post(
  '/runs/:id/email-payslips',
  manage,
  byId,
  validate(z.object({ resend: z.boolean().default(false) })),
  ah(async (req, res) => res.json(await emailRunPayslips(req.params.id, req.user!.id, req.body.resend))),
);

// ===== Payslips =====
runsRouter.get(
  '/payslips/:id',
  view,
  byId,
  ah(async (req, res) => {
    const slip = await Payslip.findById(req.params.id).lean();
    if (!slip) throw notFound('Payslip');
    await logRead(req, 'Payslip', slip._id, { employee: slip.employee, month: slip.month });
    res.json({ ...slip, layout: await payslipLayout() });
  }),
);

/** An employee sees only their own payslips, and only once the run is approved. */
runsRouter.get(
  '/my/payslips',
  authenticate,
  ah(async (req, res) => {
    const empId = requireEmployee(req);
    const approved = (await PayrollRun.find({ status: 'approved' }).select('_id').lean()).map((r) => r._id);
    const slips = await Payslip.find({ employee: empId, run: { $in: approved } }).sort({ month: -1 }).select('-inputs').lean();
    await audit({ actor: req.user!.id, action: 'payroll.read_own', entity: 'Payslip', meta: { count: slips.length } });
    const layout = await payslipLayout();
    res.json(slips.map((s) => ({ ...s, layout })));
  }),
);
