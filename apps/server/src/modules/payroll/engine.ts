import type { SalaryComponentInput, StatutorySettings } from '@cms/shared';
import { evaluateFormula, formulaDependencies, FormulaError } from './formula';
import { ceilToRupee, roundPaise, toPaise } from './money';

/**
 * Payroll engine: a pure function. Everything it needs is passed in, and everything it used is echoed in the
 * result, so a payslip can be reproduced exactly later. All amounts are integer paise.
 */

export interface EngineComponent extends Pick<SalaryComponentInput, 'code' | 'name' | 'kind' | 'taxable' | 'prorate' | 'order'> {
  fixedAmount?: number; // rupees per month
  formula?: string;
}

export interface OneTimeItem {
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  amount: number; // paise
  taxable?: boolean;
}

export interface EngineInput {
  month: string; // YYYY-MM
  components: EngineComponent[];
  attendance: { totalDays: number; paidDays: number };
  employee: { pfApplicable: boolean; esiApplicable: boolean; taxRegime: 'new' | 'old' };
  statutory: StatutorySettings;
  loanEmi?: number; // paise
  oneTime?: OneTimeItem[];
  /** Taxable income and TDS already booked this financial year (paise), for the TDS projection. */
  ytd?: { taxableIncome: number; tdsDeducted: number };
  /** Gross already paid earlier in the current half-year (paise). When absent, this month's gross x 6 is used for PT. */
  halfYearGrossBefore?: number;
}

export interface Line {
  code: string;
  name: string;
  amount: number; // paise
  note?: string;
}

export interface EngineResult {
  month: string;
  earnings: Line[];
  deductions: Line[];
  employerContributions: Line[];
  gross: number;
  taxableGross: number;
  totalDeductions: number;
  net: number;
  paidDays: number;
  totalDays: number;
  warnings: string[];
}

export class PayrollError extends Error {}

/** Components in dependency order; a cycle or unknown reference is a configuration error. */
export function resolveOrder(components: EngineComponent[]): EngineComponent[] {
  const byCode = new Map(components.map((c) => [c.code, c]));
  if (byCode.size !== components.length) throw new PayrollError('Duplicate component codes');
  const sorted: EngineComponent[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (c: EngineComponent, path: string[]) => {
    if (state.get(c.code) === 'done') return;
    if (state.get(c.code) === 'visiting') throw new PayrollError(`Circular formula: ${[...path, c.code].join(' -> ')}`);
    state.set(c.code, 'visiting');
    if (c.formula) {
      for (const dep of formulaDependencies(c.formula)) {
        const d = byCode.get(dep);
        if (!d) throw new PayrollError(`Formula of ${c.code} uses unknown component "${dep}"`);
        visit(d, [...path, c.code]);
      }
    }
    state.set(c.code, 'done');
    sorted.push(c);
  };
  [...components].sort((a, b) => a.order - b.order).forEach((c) => visit(c, []));
  return sorted;
}

/** Months left in the financial year including this one (April = 12 ... March = 1). */
const fiscalMonthsRemaining = (month: string) => {
  const m = Number(month.slice(5, 7));
  return m >= 4 ? 12 - (m - 4) : 4 - m;
};

/** Annual tax in rupees for a taxable income in rupees. */
export function annualTax(taxable: number, regime: StatutorySettings['tds']['newRegime'], cessRate: number) {
  const income = Math.max(0, taxable - regime.standardDeduction);
  let tax = 0;
  let lower = 0;
  for (const s of regime.slabs) {
    const upper = s.upTo ?? Infinity;
    if (income > lower) tax += (Math.min(income, upper) - lower) * s.rate;
    lower = upper;
  }
  if (income <= regime.rebateLimit) tax = Math.max(0, tax - regime.rebateMax);
  return Math.round(tax * (1 + cessRate));
}

export function ptHalfYearly(halfYearGrossRupees: number, slabs: StatutorySettings['pt']['slabs']) {
  for (const s of slabs) if (s.upTo === null || halfYearGrossRupees <= s.upTo) return s.amount;
  return 0;
}

export function computePayroll(input: EngineInput): EngineResult {
  const { statutory: st, attendance, employee } = input;
  if (attendance.totalDays <= 0) throw new PayrollError('totalDays must be positive');
  const ratio = Math.min(1, Math.max(0, attendance.paidDays / attendance.totalDays));
  const warnings: string[] = [];

  // 1. Evaluate components in dependency order (formulas see full, un-prorated monthly values in rupees)
  const monthly = new Map<string, number>(); // code -> paise, full month
  const scope: Record<string, number> = {};
  for (const c of resolveOrder(input.components)) {
    let rupees: number;
    try {
      rupees = c.formula ? evaluateFormula(c.formula, scope) : (c.fixedAmount ?? 0);
    } catch (e) {
      if (e instanceof FormulaError) throw new PayrollError(`${c.code}: ${e.message}`);
      throw e;
    }
    const full = Math.max(0, toPaise(rupees));
    monthly.set(c.code, full);
    scope[c.code] = full / 100;
  }

  const earnings: Line[] = [];
  const deductions: Line[] = [];
  let taxableGross = 0;
  for (const c of [...input.components].sort((a, b) => a.order - b.order)) {
    const full = monthly.get(c.code)!;
    if (c.kind === 'earning') {
      const amount = c.prorate ? roundPaise(full * ratio) : full;
      if (amount > 0) earnings.push({ code: c.code, name: c.name, amount, note: c.prorate && ratio < 1 ? `${attendance.paidDays}/${attendance.totalDays} days` : undefined });
      if (c.taxable) taxableGross += amount;
    } else if (full > 0) {
      deductions.push({ code: c.code, name: c.name, amount: full });
    }
  }
  for (const o of input.oneTime ?? []) {
    if (o.kind === 'earning') {
      earnings.push({ code: o.code, name: o.name, amount: o.amount });
      if (o.taxable !== false) taxableGross += o.amount;
    } else deductions.push({ code: o.code, name: o.name, amount: o.amount });
  }
  const gross = earnings.reduce((s, l) => s + l.amount, 0);
  const earned = (code: string) => earnings.find((l) => l.code === code)?.amount ?? 0;

  // 2. Statutory
  const employerContributions: Line[] = [];

  if (st.pf.enabled && employee.pfApplicable) {
    const wages = st.pf.basisComponents.reduce((s, code) => s + earned(code), 0);
    const base = st.pf.capAtCeiling ? Math.min(wages, toPaise(st.pf.wageCeiling)) : wages;
    const ee = roundPaise(base * st.pf.employeeRate);
    const er = roundPaise(base * st.pf.employerRate);
    if (ee > 0) deductions.push({ code: 'PF', name: 'Provident Fund', amount: ee });
    if (er > 0) employerContributions.push({ code: 'PF_ER', name: 'Employer PF', amount: er });
  }

  if (st.esi.enabled && employee.esiApplicable && gross > 0 && gross <= toPaise(st.esi.grossThreshold)) {
    deductions.push({ code: 'ESI', name: 'ESI', amount: ceilToRupee(gross * st.esi.employeeRate) });
    employerContributions.push({ code: 'ESI_ER', name: 'Employer ESI', amount: ceilToRupee(gross * st.esi.employerRate) });
  }

  const monthNo = Number(input.month.slice(5, 7));
  if (st.pt.enabled && st.pt.deductionMonths.includes(monthNo) && gross > 0) {
    const half = (input.halfYearGrossBefore !== undefined ? input.halfYearGrossBefore + gross : gross * 6) / 100;
    const pt = toPaise(ptHalfYearly(half, st.pt.slabs));
    if (pt > 0) deductions.push({ code: 'PT', name: 'Professional Tax', amount: pt });
  }

  if (st.tds.enabled && taxableGross > 0) {
    const remaining = fiscalMonthsRemaining(input.month);
    const elapsed = 12 - remaining;
    // Without year-to-date figures, assume the same pay in every month so far and tax spread evenly
    const ytdIncome = input.ytd?.taxableIncome ?? taxableGross * elapsed;
    // Projection: income so far + this month, repeated for the months left
    const projected = (ytdIncome + taxableGross * remaining) / 100;
    const regime = employee.taxRegime === 'old' ? st.tds.oldRegime : st.tds.newRegime;
    const yearTax = toPaise(annualTax(projected, regime, st.tds.cessRate));
    const alreadyDeducted = input.ytd?.tdsDeducted ?? roundPaise((yearTax * elapsed) / 12);
    const tds = Math.max(0, roundPaise((yearTax - alreadyDeducted) / remaining));
    if (tds > 0) deductions.push({ code: 'TDS', name: 'Income Tax (TDS)', amount: tds });
  }

  if ((input.loanEmi ?? 0) > 0) deductions.push({ code: 'LOAN', name: 'Loan / advance EMI', amount: input.loanEmi! });

  const totalDeductions = deductions.reduce((s, l) => s + l.amount, 0);
  const net = gross - totalDeductions;
  if (net < 0) warnings.push('Deductions exceed earnings; net pay is negative');

  return { month: input.month, earnings, deductions, employerContributions, gross, taxableGross, totalDeductions, net, paidDays: attendance.paidDays, totalDays: attendance.totalDays, warnings };
}
