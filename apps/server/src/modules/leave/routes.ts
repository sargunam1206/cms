import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, REQUEST_STATUS, balanceAdjustSchema, decisionSchema, leaveRequestSchema, leaveTypeSchema, objectId } from '@cms/shared';
import { hasPermission, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { forbidden, notFound } from '../../utils/errors';
import { inTz, now } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee, teamIds } from '../employees/model';
import { LeaveRequest, LeaveType } from './model';
import * as svc from './service';

export const leaveRouter = Router();

const currentYear = () => inTz(now()).year();
const yearQuery = z.object({ year: z.coerce.number().int().optional(), employee: objectId.optional() });

// ----- Types -----
leaveRouter.get(
  '/types',
  ah(async (req, res) => {
    const filter = hasPermission(req, PERMISSIONS.LEAVE_MANAGE) ? {} : { active: true };
    res.json(await LeaveType.find(filter).sort({ code: 1 }).lean());
  }),
);

leaveRouter.post(
  '/types',
  requirePermission(PERMISSIONS.LEAVE_MANAGE),
  validate(leaveTypeSchema),
  ah(async (req, res) => {
    const t = await LeaveType.create(req.body);
    await audit({ actor: req.user!.id, action: 'leave_type.create', entity: 'LeaveType', entityId: t._id, after: req.body });
    res.status(201).json(t);
  }),
);

leaveRouter.put(
  '/types/:id',
  requirePermission(PERMISSIONS.LEAVE_MANAGE),
  validate(leaveTypeSchema),
  ah(async (req, res) => {
    const before = await LeaveType.findById(req.params.id).lean();
    if (!before) throw notFound('Leave type');
    const t = await LeaveType.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await audit({ actor: req.user!.id, action: 'leave_type.update', entity: 'LeaveType', entityId: req.params.id, before, after: req.body });
    res.json(t);
  }),
);

// ----- Balances -----
leaveRouter.get(
  '/balances/me',
  requirePermission(PERMISSIONS.LEAVE_SELF),
  validate(yearQuery, 'query'),
  ah(async (req, res) => {
    const { year = currentYear() } = req.query as { year?: number };
    res.json(await svc.getBalances(requireEmployee(req), year));
  }),
);

leaveRouter.get(
  '/balances',
  requirePermission(PERMISSIONS.LEAVE_MANAGE, PERMISSIONS.LEAVE_APPROVE),
  validate(yearQuery, 'query'),
  ah(async (req, res) => {
    const { year = currentYear(), employee } = req.query as { year?: number; employee?: string };
    if (!employee) {
      // All employees in scope, one row each
      const filter = hasPermission(req, PERMISSIONS.LEAVE_MANAGE) ? { status: { $ne: 'exited' } } : { manager: req.user!.employeeId };
      const emps = await Employee.find(filter).select('name code').sort({ code: 1 }).lean();
      const rows = await Promise.all(emps.map(async (e) => ({ employee: e, balances: await svc.getBalances(e._id, year) })));
      return res.json(rows);
    }
    if (!hasPermission(req, PERMISSIONS.LEAVE_MANAGE)) {
      const emp = await Employee.findById(employee).select('manager').lean();
      if (String(emp?.manager) !== String(req.user!.employeeId)) throw forbidden();
    }
    res.json(await svc.getBalances(employee, year));
  }),
);

leaveRouter.post(
  '/balances/adjust',
  requirePermission(PERMISSIONS.LEAVE_MANAGE),
  validate(balanceAdjustSchema),
  ah(async (req, res) => res.json(await svc.adjustBalance(req.body, req.user!.id))),
);

leaveRouter.post(
  '/carry-forward',
  requirePermission(PERMISSIONS.LEAVE_MANAGE),
  validate(z.object({ year: z.number().int() })),
  ah(async (req, res) => res.json(await svc.carryForward(req.body.year, req.user!.id))),
);

// ----- Requests -----
leaveRouter.post(
  '/requests',
  requirePermission(PERMISSIONS.LEAVE_SELF),
  validate(leaveRequestSchema),
  ah(async (req, res) => res.status(201).json(await svc.applyLeave(requireEmployee(req), req.body, req.user!.id))),
);

leaveRouter.put(
  '/requests/:id',
  requirePermission(PERMISSIONS.LEAVE_SELF),
  validate(leaveRequestSchema),
  ah(async (req, res) => res.json(await svc.updateLeave(req.params.id, requireEmployee(req), req.body, req.user!.id))),
);

leaveRouter.get(
  '/requests/mine',
  requirePermission(PERMISSIONS.LEAVE_SELF),
  ah(async (req, res) => {
    res.json(await LeaveRequest.find({ employee: requireEmployee(req) }).populate('leaveType', 'code name').sort({ from: -1 }).limit(100).lean());
  }),
);

leaveRouter.get(
  '/requests/pending',
  requirePermission(PERMISSIONS.LEAVE_APPROVE),
  ah(async (req, res) => {
    const filter: Record<string, unknown> = { status: 'pending' };
    if (!hasPermission(req, PERMISSIONS.LEAVE_MANAGE)) {
      filter.employee = { $in: req.user!.employeeId ? await teamIds(req.user!.employeeId) : [] };
    } else if (req.user!.employeeId) {
      filter.employee = { $ne: req.user!.employeeId };
    }
    res.json(await LeaveRequest.find(filter).populate('employee', 'name code').populate('leaveType', 'code name').sort({ from: 1 }).lean());
  }),
);

leaveRouter.get(
  '/requests',
  requirePermission(PERMISSIONS.LEAVE_MANAGE),
  validate(z.object({ status: z.enum(REQUEST_STATUS).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) }), 'query'),
  ah(async (req, res) => {
    const { status, from, to, page, limit } = req.query as unknown as { status?: string; from?: string; to?: string; page: number; limit: number };
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (from) filter.to = { $gte: from };
    if (to) filter.from = { $lte: to };
    const [items, total] = await Promise.all([
      LeaveRequest.find(filter).populate('employee', 'name code').populate('leaveType', 'code name').sort({ from: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      LeaveRequest.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit });
  }),
);

leaveRouter.post(
  '/requests/:id/decision',
  requirePermission(PERMISSIONS.LEAVE_APPROVE),
  validate(decisionSchema),
  ah(async (req, res) => {
    const lr = await LeaveRequest.findById(req.params.id).select('employee').lean();
    if (!lr) throw notFound('Leave request');
    if (!hasPermission(req, PERMISSIONS.LEAVE_MANAGE)) {
      const emp = await Employee.findById(lr.employee).select('manager').lean();
      if (String(emp?.manager) !== String(req.user!.employeeId)) throw forbidden('Not your team member');
    }
    res.json(await svc.decideLeave(req.params.id, req.body.decision, req.user!, req.body.comment));
  }),
);

leaveRouter.post(
  '/requests/:id/cancel',
  ah(async (req, res) => res.json(await svc.cancelLeave(req.params.id, req.user!, hasPermission(req, PERMISSIONS.LEAVE_MANAGE)))),
);
