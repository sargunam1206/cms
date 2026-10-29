import type { Types } from 'mongoose';
import dayjs from 'dayjs';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { lastDayOfMonth, now } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee } from '../employees/model';
import { LeaveType } from '../leave/model';
import { getBalances } from '../leave/service';
import { getSetting } from '../settings/service';
import { computePayroll } from './engine';
import { FnFSettlement, Loan, Payslip, SalaryStructure } from './model';
import { roundPaise } from './money';
import { buildEngineComponents, getStatutory, previewPayslip } from './service';

type Id = Types.ObjectId | string;

export const FNF_KEY = 'fnfRules';
export interface FnFRules {
  /** Earning components whose monthly total is the base for a day's pay when encashing leave. */
  encashmentBasis: string[];
  /** Days in the month used to turn monthly pay into a daily rate. */
  daysDivisor: number;
  /** Completed years of service before gratuity is payable. */
  gratuityMinYears: number;
  /** Gratuity days of wages per year of service, over the divisor (15/26 under the Payment of Gratuity Act). */
  gratuityDays: number;
  gratuityDivisor: number;
}
export const DEFAULT_FNF_RULES: FnFRules = { encashmentBasis: ['BASIC'], daysDivisor: 30, gratuityMinYears: 5, gratuityDays: 15, gratuityDivisor: 26 };
export const getFnfRules = async (): Promise<FnFRules> => ({ ...DEFAULT_FNF_RULES, ...((await getSetting<Partial<FnFRules>>(FNF_KEY)) ?? {}) });

export interface ExtraItem {
  name: string;
  kind: 'earning' | 'deduction';
  amount: number; // rupees
}

/** Full-month amounts (paise) of each earning for the structure in force that month. */
async function fullMonthEarnings(employeeId: Id, month: string) {
  const structure = await SalaryStructure.findOne({ employee: employeeId, effectiveFrom: { $lte: lastDayOfMonth(month) } }).sort({ effectiveFrom: -1 }).lean();
  if (!structure) return null;
  const st = await getStatutory(lastDayOfMonth(month));
  const r = computePayroll({
    month,
    components: await buildEngineComponents(structure.lines),
    attendance: { totalDays: 30, paidDays: 30 },
    employee: { pfApplicable: false, esiApplicable: false, taxRegime: 'new' },
    statutory: { pf: { ...st.pf, enabled: false }, esi: { ...st.esi, enabled: false }, pt: { ...st.pt, enabled: false }, tds: { ...st.tds, enabled: false } },
  });
  return r.earnings;
}

export function serviceYears(doj: string, lastDay: string) {
  const months = dayjs(lastDay).diff(dayjs(doj), 'month');
  return { completed: Math.floor(months / 12), remainderMonths: months % 12 };
}

export async function computeFnF(employeeId: string, extra: ExtraItem[] = [], includeGratuity = false) {
  const emp = await Employee.findById(employeeId).lean();
  if (!emp) throw notFound('Employee');
  if (!emp.exitDate) throw badRequest('Set the employee\'s exit date (last working day) first');
  const rules = await getFnfRules();
  const lastDay = emp.exitDate;
  const exitMonth = lastDay.slice(0, 7);
  const lines: { code: string; name: string; kind: 'earning' | 'deduction'; amount: number; note?: string }[] = [];
  const warnings: string[] = [];

  // 1. Salary for the exit month, unless a payroll run already covers it
  const covered = await Payslip.exists({ employee: employeeId, month: exitMonth });
  if (covered) {
    warnings.push(`Salary for ${exitMonth} is already in a payroll run, so it is not added again here`);
  } else {
    try {
      const p = await previewPayslip(employeeId, exitMonth);
      if (p.net > 0) lines.push({ code: 'SALARY', name: `Salary for ${exitMonth} (up to ${lastDay})`, kind: 'earning', amount: p.net });
      warnings.push(...p.warnings);
    } catch (e) {
      warnings.push(`Pending salary not calculated: ${(e as Error).message}`);
    }
  }

  // 2. Leave encashment on encashable leave types
  const base = await fullMonthEarnings(employeeId, exitMonth);
  const monthlyBase = base ? base.filter((l) => rules.encashmentBasis.includes(l.code)).reduce((s, l) => s + l.amount, 0) : 0;
  const daily = monthlyBase / rules.daysDivisor;
  const encashable = new Set((await LeaveType.find({ encashable: true }).select('_id').lean()).map((t) => String(t._id)));
  for (const b of await getBalances(employeeId, Number(lastDay.slice(0, 4)), lastDay)) {
    if (!encashable.has(String(b.leaveType._id)) || b.available <= 0) continue;
    lines.push({ code: `ENCASH_${b.leaveType.code}`, name: `Leave encashment: ${b.leaveType.name} (${b.available} days)`, kind: 'earning', amount: roundPaise(daily * b.available) });
  }
  if (!base) warnings.push('No salary structure, so leave encashment and gratuity cannot be valued');

  // 3. Gratuity (an estimate; included only when HR chooses)
  const { completed, remainderMonths } = serviceYears(emp.dateOfJoining, lastDay);
  const eligible = completed >= rules.gratuityMinYears;
  const basic = monthlyBase;
  const countedYears = completed + (remainderMonths >= 6 ? 1 : 0);
  const estimate = eligible ? roundPaise((basic * rules.gratuityDays * countedYears) / rules.gratuityDivisor) : 0;
  if (includeGratuity && eligible) lines.push({ code: 'GRATUITY', name: `Gratuity (${countedYears} years)`, kind: 'earning', amount: estimate });
  if (includeGratuity && !eligible) warnings.push(`Not eligible for gratuity: ${completed} completed years, ${rules.gratuityMinYears} needed`);

  // 4. Outstanding loans are recovered
  for (const l of await Loan.find({ employee: employeeId, status: 'active', balance: { $gt: 0 } }).lean()) {
    lines.push({ code: 'LOAN', name: 'Loan / advance balance recovered', kind: 'deduction', amount: l.balance });
  }

  // 5. Anything else HR adds by hand
  for (const x of extra) lines.push({ code: 'OTHER', name: x.name, kind: x.kind, amount: Math.round(x.amount * 100) });

  warnings.push('Income tax on the settlement is not calculated here; have it reviewed with your CA');
  const total = lines.reduce((s, l) => s + (l.kind === 'earning' ? l.amount : -l.amount), 0);
  return { employee: emp, lastDay, lines, total, gratuity: { eligible, years: completed + remainderMonths / 12, estimate, included: includeGratuity && eligible }, warnings };
}

export async function saveFnF(employeeId: string, extra: ExtraItem[], includeGratuity: boolean, actor: Id) {
  const existing = await FnFSettlement.findOne({ employee: employeeId });
  if (existing?.status === 'finalized') throw conflict('This settlement is already finalized');
  const c = await computeFnF(employeeId, extra, includeGratuity);
  const doc = await FnFSettlement.findOneAndUpdate(
    { employee: employeeId },
    { employee: employeeId, lastWorkingDay: c.lastDay, status: 'draft', lines: c.lines, total: c.total, gratuity: c.gratuity, warnings: c.warnings, createdBy: actor },
    { upsert: true, new: true },
  );
  await audit({ actor: actor as never, action: 'payroll.fnf_save', entity: 'FnFSettlement', entityId: doc._id, meta: { employee: employeeId, total: c.total } });
  return doc;
}

/** Finalizing closes the employee's loans (they are in the settlement) and marks them exited. A second person must do it. */
export async function finalizeFnF(id: string, actor: Id) {
  const doc = await FnFSettlement.findById(id);
  if (!doc) throw notFound('Settlement');
  if (doc.status === 'finalized') throw conflict('Already finalized');
  if (String(doc.createdBy) === String(actor)) throw forbidden('The person who prepared the settlement cannot finalize it');
  await Loan.updateMany({ employee: doc.employee, status: 'active' }, { status: 'closed', balance: 0, note: `Recovered in full and final settlement` });
  await Employee.updateOne({ _id: doc.employee }, { status: 'exited' });
  doc.status = 'finalized';
  doc.finalizedBy = actor as never;
  doc.finalizedAt = now();
  await doc.save();
  await audit({ actor: actor as never, action: 'payroll.fnf_finalize', entity: 'FnFSettlement', entityId: doc._id, meta: { employee: doc.employee, total: doc.total } });
  return doc;
}
