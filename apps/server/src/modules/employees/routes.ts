import { Router } from 'express';
import { z } from 'zod';
import { EMPLOYEE_STATUS, PERMISSIONS, employeeSchema } from '@cms/shared';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { escapeRegex } from '../../utils/regex';
import { ah } from '../../utils/asyncHandler';
import { badRequest, notFound } from '../../utils/errors';
import { audit } from '../audit/model';
import { Employee } from './model';

export const employeesRouter = Router();

const listQuery = z.object({
  q: z.string().optional(),
  status: z.enum(EMPLOYEE_STATUS).optional(),
  department: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/** Blank strings from forms become null, so clearing a field on edit actually clears it. */
const clean = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v])) as T;

/** An exited employee must carry an exit date, or attendance and payroll would keep counting them. */
function assertExitDate(b: { status?: string; exitDate?: string }) {
  if (b.status === 'exited' && !b.exitDate) throw badRequest('Exit date is required when status is exited');
}

employeesRouter.get(
  '/',
  requirePermission(PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.ATTENDANCE_TEAM),
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const { q, status, department, page, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (department) filter.department = new RegExp(`^${escapeRegex(department)}$`, 'i');
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { code: rx }, { email: rx }];
    }
    // Managers without the broad view only see their own team
    if (!req.user!.permissions.has(PERMISSIONS.EMPLOYEES_VIEW)) filter.manager = req.user!.employeeId;

    const [items, total] = await Promise.all([
      Employee.find(filter)
        .populate('manager', 'name code')
        .sort({ code: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Employee.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit });
  }),
);

employeesRouter.get(
  '/departments',
  requirePermission(PERMISSIONS.EMPLOYEES_VIEW, PERMISSIONS.ATTENDANCE_TEAM),
  ah(async (_req, res) => {
    const names: string[] = (await Employee.distinct('department')).filter(Boolean);
    res.json(names.sort((a, b) => a.localeCompare(b)));
  }),
);

employeesRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.EMPLOYEES_VIEW),
  ah(async (req, res) => {
    const emp = await Employee.findById(req.params.id).populate('manager', 'name code').lean();
    if (!emp) throw notFound('Employee');
    res.json(emp);
  }),
);

employeesRouter.post(
  '/',
  requirePermission(PERMISSIONS.EMPLOYEES_MANAGE),
  validate(employeeSchema),
  ah(async (req, res) => {
    assertExitDate(req.body);
    const emp = await Employee.create(clean(req.body));
    await audit({ actor: req.user!.id, action: 'employee.create', entity: 'Employee', entityId: emp._id, after: emp.toObject() });
    res.status(201).json(emp);
  }),
);

employeesRouter.put(
  '/:id',
  requirePermission(PERMISSIONS.EMPLOYEES_MANAGE),
  validate(employeeSchema),
  ah(async (req, res) => {
    assertExitDate(req.body);
    if (req.body.manager && req.body.manager === req.params.id) throw badRequest('An employee cannot be their own manager');
    const before = await Employee.findById(req.params.id).lean();
    if (!before) throw notFound('Employee');
    const emp = await Employee.findByIdAndUpdate(req.params.id, clean(req.body), { new: true, runValidators: true });
    await audit({ actor: req.user!.id, action: 'employee.update', entity: 'Employee', entityId: req.params.id, before, after: emp?.toObject() });
    res.json(emp);
  }),
);
