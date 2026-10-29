import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, holidaySchema } from '@cms/shared';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { notFound } from '../../utils/errors';
import { audit } from '../audit/model';
import { Holiday } from './model';

export const holidaysRouter = Router();

holidaysRouter.get(
  '/',
  validate(z.object({ year: z.coerce.number().int().optional() }), 'query'),
  ah(async (req, res) => {
    const year = (req.query as { year?: number }).year ?? new Date().getFullYear();
    res.json(await Holiday.find({ date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).sort({ date: 1 }).lean());
  }),
);

holidaysRouter.post(
  '/',
  requirePermission(PERMISSIONS.HOLIDAYS_MANAGE),
  validate(holidaySchema),
  ah(async (req, res) => {
    const h = await Holiday.create(req.body);
    await audit({ actor: req.user!.id, action: 'holiday.create', entity: 'Holiday', entityId: h._id, after: req.body });
    res.status(201).json(h);
  }),
);

holidaysRouter.put(
  '/:id',
  requirePermission(PERMISSIONS.HOLIDAYS_MANAGE),
  validate(holidaySchema),
  ah(async (req, res) => {
    const before = await Holiday.findById(req.params.id).lean();
    if (!before) throw notFound('Holiday');
    const h = await Holiday.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await audit({ actor: req.user!.id, action: 'holiday.update', entity: 'Holiday', entityId: req.params.id, before, after: req.body });
    res.json(h);
  }),
);

holidaysRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.HOLIDAYS_MANAGE),
  ah(async (req, res) => {
    const h = await Holiday.findByIdAndDelete(req.params.id);
    if (!h) throw notFound('Holiday');
    await audit({ actor: req.user!.id, action: 'holiday.delete', entity: 'Holiday', entityId: req.params.id, before: h.toObject() });
    res.status(204).end();
  }),
);
