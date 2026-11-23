import type { Types } from 'mongoose';
import { PERMISSIONS } from '@cms/shared';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { lastDayOfMonth, now, todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { notify, usersOfEmployees, usersWithPermission } from '../notifications/service';
import { isMonthLocked, lockMonth, monthSummariesFor } from '../attendance/service';
import { Employee } from '../employees/model';
import { getSetting } from '../settings/service';
import { computePayroll, PayrollError, type EngineComponent, type EngineResult, type OneTimeItem as EngineOneTime } from './engine';
import { FormulaError } from './formula';
import { Loan, OneTimeItem, Payslip, PayrollRun, SalaryComponent, SalaryStructure } from './model';
import { engineComponentsFrom, getStatutory, presentPayslip } from './service';

type Id = Types.ObjectId | string;

export const WORKFLOW_KEY = 'payrollWorkflow';
export interface PayrollWorkflow {
  /** true: HR reviews and Management approves. false: HR's review is the final approval. */
  managementApproval: boolean;
}
export const getWorkflow = async (): Promise<PayrollWorkflow> => ({ managementApproval: true, ...((await getSetting<PayrollWorkflow>(WORKFLOW_KEY)) ?? {}) });

/** April-March financial year start month (YYYY-04) for a month. */
export const fiscalYearStart = (month: string) => {
  const y = Number(month.slice(0, 4));
  return Number(month.slice(5, 7)) >= 4 ? `${y}-04` : `${y - 1}-04`;
};
/** First month of the half-year (April-September or October-March) containing a month. */
export const halfYearStart = (month: string) => {
  const m = Number(month.slice(5, 7));
  const y = Number(month.slice(0, 4));
  if (m >= 4 && m <= 9) return `${y}-04`;
  return m >= 10 ? `${y}-10` : `${y - 1}-10`;
};

export async function getRun(id: string) {
  const run = await PayrollRun.findById(id);
  if (!run) throw notFound('Payroll run');
  return run;
}

const log = (run: InstanceType<typeof PayrollRun>, action: string, by: Id, comment?: string) =>
  run.history.push({ action, by: by as never, at: now(), comment } as never);

/** A run for a month that has fully ended. Locks attendance so the numbers cannot move underneath it. */
export async function createRun(month: string, actor: Id) {
  if (lastDayOfMonth(month) >= todayStr()) throw badRequest(`${month} has not ended yet; run payroll after the last day of the month`);
  if (await PayrollRun.exists({ month })) throw conflict(`A payroll run for ${month} already exists`);
  if (!(await isMonthLocked(month))) await lockMonth(month, actor as never, 'Locked by payroll run');
  const run = await PayrollRun.create({ month, createdBy: actor, history: [{ action: 'created', by: actor, at: now() }] });
  await audit({ actor: actor as never, action: 'payroll.run_create', entity: 'PayrollRun', entityId: run._id, meta: { month } });
  return run;
}

function assertEditable(run: InstanceType<typeof PayrollRun>) {
  if (run.status !== 'draft') throw conflict(`This run is ${run.status.replace('_', ' ')}; send it back to draft to change it`);
}

/**
 * Totals shown for the run. Gross and deductions are the figures each payslip prints (full pay, with loss of pay
 * listed as a deduction), so the run page, the run list and every payslip agree. Net pay is unaffected.
 */
async function refreshTotals(run: InstanceType<typeof PayrollRun>) {
  const slips = await Payslip.find({ run: run._id }).select('earnings deductions gross totalDeductions net employerContributions attendance').lean();
  const shown = slips.map((p) => presentPayslip(p));
  run.totals = {
    employees: slips.length,
    gross: shown.reduce((s, v) => s + v.gross, 0),
    deductions: shown.reduce((s, v) => s + v.totalDeductions, 0),
    net: slips.reduce((s, p) => s + (p.net ?? 0), 0),
    employerContributions: slips.reduce((s, p) => s + p.employerContributions.reduce((a, l) => a + (l.amount ?? 0), 0), 0),
  } as never;
}

/** Whole months from one YYYY-MM to another (b is later), never negative. */
const monthsBetween = (a: string, b: string) => Math.max(0, (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

type PriorSlip = { employee: Id; month: string; gross?: number | null; taxableGross?: number | null; deductions: { code?: string | null; amount?: number | null }[] };

/**
 * Year-to-date and half-year figures from earlier approved payslips of the same financial year, plus how many
 * earlier months the person was employed. Months employed without a payslip (say, before this system was used)
 * are filled in by the engine assuming the same pay, so tax and professional tax are not understated.
 */
function historyFor(approved: PriorSlip[], month: string, dateOfJoining: string) {
  const fy = fiscalYearStart(month);
  const half = halfYearStart(month);
  const joined = dateOfJoining.slice(0, 7);
  const inHalf = approved.filter((p) => p.month >= half);
  return {
    ytd: {
      taxableIncome: approved.reduce((s, p) => s + (p.taxableGross ?? 0), 0),
      tdsDeducted: approved.reduce((s, p) => s + (p.deductions.find((d) => d.code === 'TDS')?.amount ?? 0), 0),
      monthsCovered: approved.length,
      monthsEmployedBefore: monthsBetween(joined > fy ? joined : fy, month),
    },
    halfYearGrossBefore: inHalf.reduce((s, p) => s + (p.gross ?? 0), 0),
    halfYearMissingMonths: Math.max(0, monthsBetween(joined > half ? joined : half, month) - inHalf.length),
  };
}

/** Earlier approved payslips of this financial year for everyone, grouped by employee (two queries in all). */
async function approvedHistory(employeeIds: Id[], month: string) {
  const prior = await Payslip.find({ employee: { $in: employeeIds }, month: { $gte: fiscalYearStart(month), $lt: month } })
    .select('employee run month gross taxableGross deductions')
    .lean();
  const runIds = [...new Set(prior.map((p) => String(p.run)))];
  const approvedRuns = new Set((await PayrollRun.find({ _id: { $in: runIds }, status: 'approved' }).select('_id').lean()).map((r) => String(r._id)));
  const byEmp = new Map<string, PriorSlip[]>();
  for (const p of prior) {
    if (!approvedRuns.has(String(p.run))) continue;
    const k = String(p.employee);
    if (!byEmp.has(k)) byEmp.set(k, []);
    byEmp.get(k)!.push(p as PriorSlip);
  }
  return byEmp;
}

export async function computeRun(runId: string, actor: Id) {
  const run = await getRun(runId);
  assertEditable(run);
  const month = run.month;
  const first = `${month}-01`;
  const last = lastDayOfMonth(month);
  const statutory = await getStatutory(last);

  const employees = await Employee.find({
    type: { $ne: 'intern' }, // interns get a stipend, tracked under Interns, not a payslip
    dateOfJoining: { $lte: last },
    $or: [{ exitDate: null }, { exitDate: { $exists: false } }, { exitDate: '' }, { exitDate: { $gte: first } }],
  }).lean();

  await Payslip.deleteMany({ run: run._id });
  const skipped: { employee: Id; name: string; code: string; reason: string }[] = [];
  const slips = [];

  // Everything the run needs is read up front in a handful of queries, then worked out in memory
  const ids = employees.map((e) => e._id);
  const [structureDocs, summaries, oneTimeDocs, loanDocs, history, master] = await Promise.all([
    SalaryStructure.find({ employee: { $in: ids }, effectiveFrom: { $lte: last } }).sort({ effectiveFrom: -1 }).lean(),
    monthSummariesFor(employees, month),
    OneTimeItem.find({ employee: { $in: ids }, month }).lean(),
    Loan.find({ employee: { $in: ids }, status: 'active', startMonth: { $lte: month }, balance: { $gt: 0 } }).lean(),
    approvedHistory(ids, month),
    SalaryComponent.find({ active: true }).lean(),
  ]);
  const structureOf = new Map<string, (typeof structureDocs)[number]>();
  for (const st of structureDocs) if (!structureOf.has(String(st.employee))) structureOf.set(String(st.employee), st); // newest first
  const group = <T extends { employee: unknown }>(docs: T[]) => {
    const m = new Map<string, T[]>();
    for (const d of docs) m.set(String(d.employee), [...(m.get(String(d.employee)) ?? []), d]);
    return m;
  };
  const oneTimeBy = group(oneTimeDocs);
  const loansBy = group(loanDocs);

  for (const emp of employees) {
    const key = String(emp._id);
    const structure = structureOf.get(key);
    if (!structure) {
      skipped.push({ employee: emp._id, name: emp.name, code: emp.code, reason: 'No salary structure' });
      continue;
    }
    const summary = summaries.get(key)!;
    if (summary.pendingDays > 0) {
      skipped.push({ employee: emp._id, name: emp.name, code: emp.code, reason: `${summary.pendingDays} attendance day(s) still pending` });
      continue;
    }
    const oneTime: EngineOneTime[] = (oneTimeBy.get(key) ?? []).map((o) => ({
      code: o.code, name: o.name, kind: o.kind, amount: o.amount, taxable: o.taxable,
    }));
    // EMI due this month: the smaller of the instalment and what is left
    const loans = (loansBy.get(key) ?? []).map((l) => ({ loan: l._id, amount: Math.min(l.emi, l.balance) }));
    const hist = historyFor(history.get(key) ?? [], month, emp.dateOfJoining);
    let components: EngineComponent[];
    try {
      components = engineComponentsFrom(master, structure.lines);
    } catch (e) {
      skipped.push({ employee: emp._id, name: emp.name, code: emp.code, reason: (e as Error).message });
      continue;
    }

    let result: EngineResult;
    try {
      result = computePayroll({
        month,
        components,
        attendance: { totalDays: summary.totalDays, paidDays: summary.paidDays },
        employee: { pfApplicable: emp.pfApplicable, esiApplicable: emp.esiApplicable, taxRegime: emp.taxRegime },
        statutory,
        loanEmi: loans.reduce((s, l) => s + l.amount, 0),
        oneTime,
        ytd: hist.ytd,
        halfYearGrossBefore: hist.halfYearGrossBefore,
        halfYearMissingMonths: hist.halfYearMissingMonths,
      });
    } catch (e) {
      if (e instanceof PayrollError || e instanceof FormulaError) {
        skipped.push({ employee: emp._id, name: emp.name, code: emp.code, reason: e.message });
        continue;
      }
      throw e;
    }

    slips.push({
      run: run._id,
      month,
      employee: emp._id,
      person: {
        name: emp.name, code: emp.code, designation: emp.designation, department: emp.department, dateOfJoining: emp.dateOfJoining, gender: emp.gender, branch: emp.branch,
        pan: emp.pan, uan: emp.uan, esiNumber: emp.esiNumber, bank: emp.bank,
      },
      attendance: {
        totalDays: summary.totalDays, paidDays: summary.paidDays, lopDays: summary.lopDays, presentDays: summary.presentDays,
        paidLeaveDays: summary.paidLeaveDays, lateCount: summary.lateCount,
      },
      earnings: result.earnings,
      deductions: result.deductions,
      employerContributions: result.employerContributions,
      gross: result.gross,
      taxableGross: result.taxableGross,
      totalDeductions: result.totalDeductions,
      net: result.net,
      loans,
      warnings: result.warnings,
      inputs: { components, statutory, ytd: hist.ytd, halfYearGrossBefore: hist.halfYearGrossBefore, halfYearMissingMonths: hist.halfYearMissingMonths, oneTime },
    });
  }

  if (slips.length) await Payslip.insertMany(slips);
  run.skipped = skipped as never;
  run.computedAt = now();
  await refreshTotals(run);
  log(run, 'computed', actor, `${slips.length} payslips, ${skipped.length} skipped`);
  await run.save();
  await audit({ actor: actor as never, action: 'payroll.run_compute', entity: 'PayrollRun', entityId: run._id, meta: { month, payslips: slips.length, skipped: skipped.length } });
  return run;
}

/** HR sends the run on. With management approval switched off, this is the final approval. */
export async function submitRun(runId: string, actor: { id: Id }) {
  const run = await getRun(runId);
  assertEditable(run);
  if (!run.computedAt || !run.totals?.employees) throw badRequest('Calculate the payslips (Recalculate) before submitting, so changes made since are included');
  if (await Payslip.exists({ run: run._id, net: { $lt: 0 } })) throw badRequest('Some payslips have negative net pay; fix them before submitting');
  run.hrReviewedBy = actor.id as never;
  run.hrReviewedAt = now();
  log(run, 'hr_reviewed', actor.id);
  const wf = await getWorkflow();
  if (wf.managementApproval) {
    run.status = 'hr_reviewed';
    await run.save();
    await notify({ type: 'payroll.submitted', to: await usersWithPermission(PERMISSIONS.PAYROLL_APPROVE), actor: actor.id, title: `Payroll for ${run.month} is waiting for your approval`, body: `${run.totals?.employees ?? 0} payslips`, link: `/payroll/runs/${run._id}`, entity: { kind: 'PayrollRun', id: run._id } });
  } else {
    await finalize(run, actor.id);
  }
  await audit({ actor: actor.id as never, action: 'payroll.run_submit', entity: 'PayrollRun', entityId: run._id, meta: { month: run.month, status: run.status } });
  return run;
}

async function finalize(run: InstanceType<typeof PayrollRun>, actor: Id) {
  const slips = await Payslip.find({ run: run._id }).select('loans').lean();
  // Loan balances move only now, never while a run is still a draft
  for (const s of slips) {
    for (const l of s.loans) {
      const loan = await Loan.findById(l.loan);
      if (!loan) continue;
      loan.balance = Math.max(0, loan.balance - (l.amount ?? 0));
      if (loan.balance === 0) loan.status = 'closed';
      await loan.save();
    }
  }
  run.status = 'approved';
  run.approvedBy = actor as never;
  run.approvedAt = now();
  log(run, 'approved', actor);
  await run.save();
  const paid = await Payslip.find({ run: run._id }).select('employee').lean();
  await notify({ type: 'payslip.ready', to: await usersOfEmployees(paid.map((s) => s.employee)), actor, title: `Your payslip for ${run.month} is ready`, link: '/my/payslips', entity: { kind: 'PayrollRun', id: run._id } });
}

export async function approveRun(runId: string, actor: { id: Id }) {
  const run = await getRun(runId);
  if (run.status !== 'hr_reviewed') throw conflict('Only a run that HR has submitted can be approved');
  if (String(run.hrReviewedBy) === String(actor.id)) throw forbidden('The person who reviewed the run cannot also approve it');
  await finalize(run, actor.id);
  await audit({ actor: actor.id as never, action: 'payroll.run_approve', entity: 'PayrollRun', entityId: run._id, meta: { month: run.month, net: run.totals?.net } });
  await notify({ type: 'payroll.decided', to: run.hrReviewedBy ? [run.hrReviewedBy as never] : [], actor: actor.id, title: `Payroll for ${run.month} was approved`, link: `/payroll/runs/${run._id}`, entity: { kind: 'PayrollRun', id: run._id } });
  return run;
}

export async function rejectRun(runId: string, actor: { id: Id }, comment: string) {
  const run = await getRun(runId);
  if (run.status !== 'hr_reviewed') throw conflict('Only a submitted run can be sent back');
  run.status = 'draft';
  run.computedAt = undefined; // fixes happen after this, so the figures must be recalculated before resubmitting
  log(run, 'rejected', actor.id, comment);
  await run.save();
  await audit({ actor: actor.id as never, action: 'payroll.run_reject', entity: 'PayrollRun', entityId: run._id, meta: { month: run.month, comment } });
  await notify({ type: 'payroll.decided', to: run.hrReviewedBy ? [run.hrReviewedBy as never] : [], actor: actor.id, title: `Payroll for ${run.month} was sent back`, body: comment, link: `/payroll/runs/${run._id}`, entity: { kind: 'PayrollRun', id: run._id } });
  return run;
}

/** Reverses an approval (loan balances are restored) so the run can be corrected. Always logged with a reason. */
export async function reopenRun(runId: string, actor: { id: Id }, reason: string) {
  const run = await getRun(runId);
  if (run.status !== 'approved') throw conflict('Only an approved run can be reopened');
  const later = await PayrollRun.exists({ month: { $gt: run.month }, status: 'approved' });
  if (later) throw conflict('A later month is already approved; reopen that one first');
  const slips = await Payslip.find({ run: run._id }).select('loans').lean();
  for (const s of slips) {
    for (const l of s.loans) {
      await Loan.updateOne({ _id: l.loan }, { $inc: { balance: l.amount ?? 0 }, $set: { status: 'active' } });
    }
  }
  run.status = 'draft';
  run.approvedBy = undefined;
  run.approvedAt = undefined;
  run.hrReviewedBy = undefined;
  run.hrReviewedAt = undefined;
  run.computedAt = undefined; // the old payslips are stale until recalculated
  log(run, 'reopened', actor.id, reason);
  await run.save();
  await audit({ actor: actor.id as never, action: 'payroll.run_reopen', entity: 'PayrollRun', entityId: run._id, meta: { month: run.month, reason } });
  return run;
}

export async function deleteRun(runId: string, actor: Id) {
  const run = await getRun(runId);
  assertEditable(run);
  await Payslip.deleteMany({ run: run._id });
  await run.deleteOne();
  await audit({ actor: actor as never, action: 'payroll.run_delete', entity: 'PayrollRun', entityId: run._id, meta: { month: run.month } });
}

/** One-time items may only change while their month has no submitted or approved run. */
export async function assertMonthOpenForAdjustments(month: string) {
  const run = await PayrollRun.findOne({ month }).lean();
  if (run && run.status !== 'draft') throw conflict(`Payroll for ${month} is ${run.status.replace('_', ' ')}; send it back to draft first`);
}
