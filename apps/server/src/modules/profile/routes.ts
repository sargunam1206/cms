import { Router } from 'express';
import { PERMISSIONS, bankChangeSchema, contactUpdateSchema, decisionSchema } from '@cms/shared';
import { authenticate, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, forbidden, notFound } from '../../utils/errors';
import { now } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee } from '../employees/model';
import { BankChangeRequest } from './model';

export const profileRouter = Router();
profileRouter.use(authenticate);

// Phone is low-risk, so employees change it directly (audited)
profileRouter.put(
  '/contact',
  validate(contactUpdateSchema),
  ah(async (req, res) => {
    const empId = requireEmployee(req);
    const before = await Employee.findById(empId).select('phone').lean();
    if (!before) throw notFound('Employee');
    await Employee.updateOne({ _id: empId }, { phone: req.body.phone });
    await audit({ actor: req.user!.id, action: 'profile.contact_update', entity: 'Employee', entityId: empId, before: { phone: before.phone }, after: { phone: req.body.phone } });
    res.json({ phone: req.body.phone });
  }),
);

// Bank details feed payroll, so a change is a request that HR must approve
profileRouter.get(
  '/bank-changes',
  ah(async (req, res) => {
    const empId = requireEmployee(req);
    res.json(await BankChangeRequest.find({ employee: empId }).sort({ createdAt: -1 }).limit(10).lean());
  }),
);

profileRouter.post(
  '/bank-changes',
  validate(bankChangeSchema),
  ah(async (req, res) => {
    const empId = requireEmployee(req);
    // One open request at a time: a new one replaces the previous pending one
    await BankChangeRequest.updateMany({ employee: empId, status: 'pending' }, { status: 'cancelled' });
    const doc = await BankChangeRequest.create({ employee: empId, bank: req.body });
    await audit({ actor: req.user!.id, action: 'profile.bank_change_requested', entity: 'BankChangeRequest', entityId: doc._id, after: { ifsc: req.body.ifsc, bankName: req.body.bankName } });
    res.status(201).json(doc);
  }),
);

profileRouter.get(
  '/bank-changes/pending',
  requirePermission(PERMISSIONS.EMPLOYEES_MANAGE),
  ah(async (_req, res) => {
    res.json(
      await BankChangeRequest.find({ status: 'pending' })
        .sort({ createdAt: 1 })
        .populate('employee', 'name code bank')
        .lean(),
    );
  }),
);

profileRouter.post(
  '/bank-changes/:id/decision',
  requirePermission(PERMISSIONS.EMPLOYEES_MANAGE),
  validate(decisionSchema),
  ah(async (req, res) => {
    const doc = await BankChangeRequest.findById(req.params.id);
    if (!doc) throw notFound('Request');
    if (doc.status !== 'pending') throw badRequest(`Request is already ${doc.status}`);
    if (String(doc.employee) === String(req.user!.employeeId)) throw forbidden('You cannot decide your own request');
    const { decision, comment } = req.body;
    if (decision === 'approved') {
      const emp = await Employee.findById(doc.employee).select('bank').lean();
      await Employee.updateOne({ _id: doc.employee }, { bank: doc.bank });
      await audit({ actor: req.user!.id, action: 'profile.bank_change_approved', entity: 'Employee', entityId: doc.employee, before: emp?.bank, after: doc.bank });
    } else {
      await audit({ actor: req.user!.id, action: 'profile.bank_change_rejected', entity: 'BankChangeRequest', entityId: doc._id, meta: { comment } });
    }
    doc.status = decision;
    doc.decidedBy = req.user!.id as never;
    doc.decidedAt = now();
    doc.comment = comment;
    await doc.save();
    res.json(doc);
  }),
);
