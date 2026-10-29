import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@cms/shared';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { AuditLog } from './model';

export const auditRouter = Router();

const query = z.object({
  entity: z.string().optional(),
  action: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // office-timezone dates, inclusive
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get(
  '/',
  requirePermission(PERMISSIONS.AUDIT_VIEW),
  validate(query, 'query'),
  ah(async (req, res) => {
    const { entity, action, from, to, page, limit } = req.query as unknown as z.infer<typeof query>;
    const filter: Record<string, unknown> = {};
    if (entity) filter.entity = entity;
    if (action) filter.action = { $regex: `^${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.$gte = new Date(`${from}T00:00:00+05:30`);
      if (to) range.$lte = new Date(`${to}T23:59:59.999+05:30`);
      filter.createdAt = range;
    }
    const [items, total] = await Promise.all([
      AuditLog.find(filter).populate('actor', 'email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ items, total, page, limit });
  }),
);
