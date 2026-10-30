import express, { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, objectId } from '@cms/shared';
import { authenticate, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { audit } from '../audit/model';
import { companyForPdf } from '../company/service';
import { REPORT_TYPES, bankSheet, payslipPdf, payslipsPdf, reportSheet, type SlipRecord } from './documents';
import { applySalarySheet, checkRows, parseSalarySheet, salaryTemplate } from './salary-import';
import { Payslip, PayrollRun } from './model';
import { getRun } from './runs';
import { payslipLayout } from './service';

export const exportsRouter = Router();
const view = requirePermission(PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_MANAGE);
const idParam = validate(z.object({ id: objectId }), 'params');

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const send = (res: import('express').Response, body: Buffer, type: string, name: string) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
};

/** Payslip PDF for payroll staff. */
exportsRouter.get(
  '/payslips/:id/pdf',
  view,
  idParam,
  ah(async (req, res) => {
    const slip = await Payslip.findById(req.params.id).lean();
    if (!slip) throw notFound('Payslip');
    await audit({ actor: req.user!.id, action: 'payroll.read', entity: 'Payslip', entityId: slip._id, meta: { employee: slip.employee, month: slip.month, pdf: true } });
    send(res, await payslipPdf(slip as never, await companyForPdf(), await payslipLayout()), 'application/pdf', `payslip-${slip.person?.code}-${slip.month}.pdf`);
  }),
);

/** An employee's own payslip PDF, only after the run is approved. */
exportsRouter.get(
  '/my/payslips/:id/pdf',
  authenticate,
  idParam,
  ah(async (req, res) => {
    const empId = requireEmployee(req);
    const slip = await Payslip.findOne({ _id: req.params.id, employee: empId }).lean();
    const run = slip && (await PayrollRun.findById(slip.run).select('status').lean());
    if (!slip || run?.status !== 'approved') throw notFound('Payslip');
    await audit({ actor: req.user!.id, action: 'payroll.read_own', entity: 'Payslip', entityId: slip._id, meta: { pdf: true } });
    send(res, await payslipPdf(slip as never, await companyForPdf(), await payslipLayout()), 'application/pdf', `payslip-${slip.month}.pdf`);
  }),
);

/** Bank transfer sheet: only for approved runs, so money is never sent from a draft. */
exportsRouter.get(
  '/runs/:id/bank',
  view,
  idParam,
  ah(async (req, res) => {
    const run = await getRun(req.params.id);
    if (run.status !== 'approved') throw conflict('The bank file is available once the run is approved');
    const slips = await Payslip.find({ run: run._id }).sort({ 'person.code': 1 }).lean();
    const { buffer, missing, total } = await bankSheet(slips as SlipRecord[], run.month);
    await audit({ actor: req.user!.id, action: 'payroll.export_bank', entity: 'PayrollRun', entityId: run._id, meta: { month: run.month, rows: slips.length, missingBank: missing, total } });
    res.setHeader('X-Missing-Bank-Details', String(missing));
    send(res, buffer, XLSX, `bank-transfer-${run.month}.xlsx`);
  }),
);

exportsRouter.get(
  '/runs/:id/reports/:type',
  view,
  validate(z.object({ id: objectId, type: z.enum(REPORT_TYPES) }), 'params'),
  ah(async (req, res) => {
    const run = await getRun(req.params.id);
    const type = req.params.type as (typeof REPORT_TYPES)[number];
    const slips = await Payslip.find({ run: run._id }).sort({ 'person.code': 1 }).lean();
    await audit({ actor: req.user!.id, action: 'payroll.export_report', entity: 'PayrollRun', entityId: run._id, meta: { month: run.month, type, status: run.status } });
    send(res, await reportSheet(type, slips as SlipRecord[], run.month), XLSX, `${type}-${run.month}.xlsx`);
  }),
);

/** Every payslip in a run as one PDF (one page each) for printing or emailing in bulk. */
exportsRouter.get(
  '/runs/:id/payslips.pdf',
  view,
  idParam,
  ah(async (req, res) => {
    const run = await getRun(req.params.id);
    const slips = await Payslip.find({ run: run._id }).sort({ 'person.code': 1 }).lean();
    if (!slips.length) throw conflict('Calculate the run first; there are no payslips yet');
    await audit({ actor: req.user!.id, action: 'payroll.export_payslips', entity: 'PayrollRun', entityId: run._id, meta: { month: run.month, count: slips.length, status: run.status } });
    send(res, await payslipsPdf(slips as never, await companyForPdf(), await payslipLayout()), 'application/pdf', `payslips-${run.month}.pdf`);
  }),
);

// ----- Bulk salary entry through Excel -----
const manage = requirePermission(PERMISSIONS.PAYROLL_MANAGE);

exportsRouter.get(
  '/salary-template',
  manage,
  ah(async (req, res) => {
    await audit({ actor: req.user!.id, action: 'payroll.read', entity: 'SalaryStructure', meta: { template: true } });
    send(res, await salaryTemplate(), XLSX, 'salary-template.xlsx');
  }),
);

/** ?apply=1 saves; without it the file is only checked. The body is the raw .xlsx file. */
exportsRouter.post(
  '/salary-import',
  manage,
  express.raw({ type: [XLSX, 'application/octet-stream'], limit: '5mb' }),
  ah(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('Send the Excel file as the request body');
    let rows;
    try {
      rows = await checkRows(await parseSalarySheet(req.body));
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const errors = rows.filter((r) => r.errors.length).length;
    if (req.query.apply === '1') {
      const { applied } = await applySalarySheet(rows, req.user!.id);
      return res.json({ applied, errors, rows });
    }
    res.json({ applied: 0, errors, rows });
  }),
);
