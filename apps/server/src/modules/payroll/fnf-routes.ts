import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectId } from '@cms/shared';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { conflict, notFound } from '../../utils/errors';
import { audit } from '../audit/model';
import { setSetting } from '../settings/service';
import { FNF_KEY, computeFnF, finalizeFnF, getFnfRules, saveFnF } from './fnf';
import { FnFSettlement } from './model';

export const fnfRouter = Router();
const view = requirePermission(PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_MANAGE);
const manage = requirePermission(PERMISSIONS.PAYROLL_MANAGE);
const byId = validate(z.object({ id: objectId }), 'params');

const body = z.object({
  employee: objectId,
  includeGratuity: z.boolean().default(false),
  extra: z.array(z.object({ name: z.string().min(2).max(80), kind: z.enum(['earning', 'deduction']), amount: z.number().positive().max(100_000_000) })).max(20).default([]),
});

const rulesSchema = z.object({
  encashmentBasis: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(1),
  daysDivisor: z.number().int().min(1).max(31),
  gratuityMinYears: z.number().min(0).max(50),
  gratuityDays: z.number().min(0).max(100),
  gratuityDivisor: z.number().min(1).max(100),
});

fnfRouter.get('/fnf-rules', view, ah(async (_req, res) => res.json(await getFnfRules())));
fnfRouter.put(
  '/fnf-rules',
  manage,
  validate(rulesSchema),
  ah(async (req, res) => {
    await setSetting(FNF_KEY, req.body, '1970-01-01', req.user!.id);
    res.json(await getFnfRules());
  }),
);

fnfRouter.get(
  '/fnf',
  view,
  ah(async (req, res) => {
    await audit({ actor: req.user!.id, action: 'payroll.read', entity: 'FnFSettlement' });
    res.json(await FnFSettlement.find().populate('employee', 'name code exitDate').sort({ createdAt: -1 }).lean());
  }),
);

/** Calculates without saving, so HR can see the numbers before preparing the settlement. */
fnfRouter.post(
  '/fnf/preview',
  view,
  validate(body),
  ah(async (req, res) => {
    const c = await computeFnF(req.body.employee, req.body.extra, req.body.includeGratuity);
    await audit({ actor: req.user!.id, action: 'payroll.read', entity: 'FnFSettlement', meta: { employee: req.body.employee, preview: true } });
    res.json({ lastWorkingDay: c.lastDay, lines: c.lines, total: c.total, gratuity: c.gratuity, warnings: c.warnings });
  }),
);

fnfRouter.post('/fnf', manage, validate(body), ah(async (req, res) => res.status(201).json(await saveFnF(req.body.employee, req.body.extra, req.body.includeGratuity, req.user!.id))));

fnfRouter.post(
  '/fnf/:id/finalize',
  requirePermission(PERMISSIONS.PAYROLL_APPROVE),
  byId,
  ah(async (req, res) => res.json(await finalizeFnF(req.params.id, req.user!.id))),
);

fnfRouter.delete(
  '/fnf/:id',
  manage,
  byId,
  ah(async (req, res) => {
    const doc = await FnFSettlement.findById(req.params.id);
    if (!doc) throw notFound('Settlement');
    if (doc.status === 'finalized') throw conflict('A finalized settlement cannot be deleted');
    await doc.deleteOne();
    await audit({ actor: req.user!.id, action: 'payroll.fnf_delete', entity: 'FnFSettlement', entityId: doc._id });
    res.status(204).end();
  }),
);
