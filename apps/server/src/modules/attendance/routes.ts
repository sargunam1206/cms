import { Router, type Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS, attendanceBulkOverrideSchema, attendanceLateReliefSchema, attendanceOverrideSchema, decisionSchema, monthStr, regularizationSchema, unlockSchema } from '@cms/shared';
import { hasPermission, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { escapeRegex } from '../../utils/regex';
import { ah } from '../../utils/asyncHandler';
import { forbidden, notFound } from '../../utils/errors';
import { currentMonthStr } from '../../utils/time';
import { Employee, teamIds } from '../employees/model';
import { AttendanceLock, RegularizationRequest } from './model';
import * as svc from './service';

export const attendanceRouter = Router();

const monthQuery = z.object({ month: monthStr.optional() });
const registerQuery = monthQuery.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100), q: z.string().max(100).optional(), department: z.string().max(60).optional() });
const monthOf = (req: Request) => (req.query as { month?: string }).month ?? currentMonthStr();

/** Employee filter the caller may see: everyone (attendance.all) or direct reports (attendance.team). */
export async function scopeFilter(req: Request): Promise<Record<string, unknown>> {
  if (hasPermission(req, PERMISSIONS.ATTENDANCE_ALL)) return {};
  if (hasPermission(req, PERMISSIONS.ATTENDANCE_TEAM) && req.user!.employeeId) return { manager: req.user!.employeeId };
  throw forbidden();
}

async function assertCanView(req: Request, employeeId: string) {
  if (req.user!.employeeId && String(req.user!.employeeId) === employeeId) return;
  if (hasPermission(req, PERMISSIONS.ATTENDANCE_ALL)) return;
  if (hasPermission(req, PERMISSIONS.ATTENDANCE_TEAM) && req.user!.employeeId) {
    const emp = await Employee.findById(employeeId).select('manager').lean();
    if (!emp) throw notFound('Employee');
    if (String(emp.manager) === String(req.user!.employeeId)) return;
  }
  throw forbidden();
}

// ----- Self -----
attendanceRouter.get(
  '/today',
  requirePermission(PERMISSIONS.ATTENDANCE_SELF),
  ah(async (req, res) => res.json(await svc.getToday(requireEmployee(req)))),
);

// The body is ignored on purpose: the timestamp always comes from the server clock.
attendanceRouter.post(
  '/check-in',
  requirePermission(PERMISSIONS.ATTENDANCE_SELF),
  ah(async (req, res) => res.status(201).json(await svc.checkIn(requireEmployee(req), req.user!.id))),
);

attendanceRouter.post(
  '/check-out',
  requirePermission(PERMISSIONS.ATTENDANCE_SELF),
  ah(async (req, res) => res.json(await svc.checkOut(requireEmployee(req), req.user!.id))),
);

attendanceRouter.get(
  '/me',
  requirePermission(PERMISSIONS.ATTENDANCE_SELF),
  validate(monthQuery, 'query'),
  ah(async (req, res) => res.json(await svc.employeeMonth(requireEmployee(req), monthOf(req)))),
);

// ----- Team / HR -----
attendanceRouter.get(
  '/register',
  requirePermission(PERMISSIONS.ATTENDANCE_TEAM, PERMISSIONS.ATTENDANCE_ALL),
  validate(registerQuery, 'query'),
  ah(async (req, res) => {
    const { q, department, page, limit } = req.query as unknown as { q?: string; department?: string; page: number; limit: number };
    const filter: Record<string, unknown> = await scopeFilter(req);
    if (department) filter.department = new RegExp(`^${escapeRegex(department)}$`, 'i');
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$and = [{ $or: [{ name: rx }, { code: rx }] }];
    }
    res.json(await svc.monthRegister(monthOf(req), filter, page, limit));
  }),
);

attendanceRouter.get(
  '/employee/:id',
  validate(monthQuery, 'query'),
  ah(async (req, res) => {
    await assertCanView(req, req.params.id);
    res.json(await svc.employeeMonth(req.params.id, monthOf(req)));
  }),
);

// ----- HR override -----
attendanceRouter.post(
  '/override',
  requirePermission(PERMISSIONS.ATTENDANCE_OVERRIDE),
  validate(attendanceOverrideSchema),
  ah(async (req, res) => res.json(await svc.overrideDay(req.body, req.user!))),
);

attendanceRouter.post(
  '/late-relief',
  requirePermission(PERMISSIONS.ATTENDANCE_OVERRIDE),
  validate(attendanceLateReliefSchema),
  ah(async (req, res) => res.json(await svc.setLateRelief(req.body, req.user!))),
);

attendanceRouter.post(
  '/override/bulk',
  requirePermission(PERMISSIONS.ATTENDANCE_OVERRIDE),
  validate(attendanceBulkOverrideSchema),
  ah(async (req, res) => res.json(await svc.bulkOverride(req.body, req.user!))),
);

// ----- Locks -----
attendanceRouter.get(
  '/locks',
  requirePermission(PERMISSIONS.ATTENDANCE_ALL),
  ah(async (_req, res) => {
    res.json(await AttendanceLock.find().populate('history.by', 'email').sort({ month: -1 }).lean());
  }),
);

attendanceRouter.post(
  '/locks/:month/lock',
  requirePermission(PERMISSIONS.ATTENDANCE_LOCK),
  validate(z.object({ month: monthStr }), 'params'),
  ah(async (req, res) => res.json(await svc.lockMonth(req.params.month, req.user!.id, req.body?.reason))),
);

attendanceRouter.post(
  '/locks/:month/unlock',
  requirePermission(PERMISSIONS.ATTENDANCE_LOCK),
  validate(z.object({ month: monthStr }), 'params'),
  validate(unlockSchema),
  ah(async (req, res) => res.json(await svc.unlockMonth(req.params.month, req.user!.id, req.body.reason))),
);

// ----- Regularization -----
export const regularizationRouter = Router();

regularizationRouter.post(
  '/',
  requirePermission(PERMISSIONS.ATTENDANCE_SELF),
  validate(regularizationSchema),
  ah(async (req, res) => res.status(201).json(await svc.createRegularization(requireEmployee(req), req.body, req.user!.id))),
);

regularizationRouter.put(
  '/:id',
  requirePermission(PERMISSIONS.ATTENDANCE_SELF),
  validate(regularizationSchema),
  ah(async (req, res) => res.json(await svc.updateRegularization(req.params.id, requireEmployee(req), req.body, req.user!.id))),
);

regularizationRouter.get(
  '/mine',
  requirePermission(PERMISSIONS.ATTENDANCE_SELF),
  ah(async (req, res) => {
    res.json(await RegularizationRequest.find({ employee: requireEmployee(req) }).sort({ createdAt: -1 }).limit(100).lean());
  }),
);

regularizationRouter.get(
  '/pending',
  requirePermission(PERMISSIONS.REGULARIZATION_APPROVE),
  ah(async (req, res) => {
    const filter: Record<string, unknown> = { status: 'pending' };
    if (!hasPermission(req, PERMISSIONS.ATTENDANCE_ALL)) {
      filter.employee = { $in: req.user!.employeeId ? await teamIds(req.user!.employeeId) : [] };
    } else if (req.user!.employeeId) {
      filter.employee = { $ne: req.user!.employeeId };
    }
    res.json(await RegularizationRequest.find(filter).populate('employee', 'name code').sort({ date: 1 }).lean());
  }),
);

regularizationRouter.post(
  '/:id/decision',
  requirePermission(PERMISSIONS.REGULARIZATION_APPROVE),
  validate(decisionSchema),
  ah(async (req, res) => {
    const reg = await RegularizationRequest.findById(req.params.id).select('employee').lean();
    if (!reg) throw notFound('Request');
    await assertCanView(req, String(reg.employee));
    res.json(await svc.decideRegularization(req.params.id, req.body.decision, req.user!, req.body.comment));
  }),
);

regularizationRouter.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.ATTENDANCE_SELF),
  ah(async (req, res) => res.json(await svc.cancelRegularization(req.params.id, requireEmployee(req), req.user!.id))),
);
