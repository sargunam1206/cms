import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUTORY } from '@cms/shared';
import { annualTax, computePayroll, PayrollError, ptHalfYearly, resolveOrder, type EngineComponent, type EngineInput } from './engine';
import { evaluateFormula, formulaDependencies } from './formula';
import { presentPayslip } from './service';

const comp = (code: string, o: Partial<EngineComponent> = {}): EngineComponent => ({
  code,
  name: code,
  kind: 'earning',
  taxable: true,
  prorate: true,
  order: 0,
  ...o,
});
const NO_STAT = { pfApplicable: false, esiApplicable: false, taxRegime: 'new' as const };
const base = (over: Partial<EngineInput> = {}): EngineInput => ({
  month: '2026-10',
  components: [comp('BASIC', { fixedAmount: 20000, order: 1 }), comp('HRA', { formula: 'BASIC*0.4', order: 2 }), comp('SPECIAL', { fixedAmount: 12000, order: 3 })],
  attendance: { totalDays: 31, paidDays: 31 },
  employee: { pfApplicable: true, esiApplicable: false, taxRegime: 'new' },
  statutory: DEFAULT_STATUTORY,
  ...over,
});
const line = (ls: { code: string; amount: number }[], code: string) => ls.find((l) => l.code === code)?.amount;

describe('formulas', () => {
  it('evaluates arithmetic over component codes', () => {
    expect(evaluateFormula('BASIC*0.4 + 100', { BASIC: 20000 })).toBe(8100);
    expect(evaluateFormula('min(BASIC*0.5, 5000)', { BASIC: 20000 })).toBe(5000);
  });

  it('lists dependencies and rejects anything but arithmetic', () => {
    expect(formulaDependencies('BASIC*0.4+DA').sort()).toEqual(['BASIC', 'DA']);
    expect(() => formulaDependencies('import("fs")')).toThrow();
    expect(() => formulaDependencies('evaluate("1+1")')).toThrow();
    expect(() => formulaDependencies('a.b')).toThrow();
    expect(() => formulaDependencies('[1,2,3]')).toThrow();
    expect(() => formulaDependencies('x = 5')).toThrow();
  });

  it('orders by dependency and catches cycles and unknown codes', () => {
    const order = resolveOrder([comp('B', { formula: 'A*2', order: 1 }), comp('A', { fixedAmount: 1, order: 2 })]).map((c) => c.code);
    expect(order).toEqual(['A', 'B']);
    expect(() => resolveOrder([comp('A', { formula: 'B', order: 1 }), comp('B', { formula: 'A', order: 2 })])).toThrow(/Circular/);
    expect(() => resolveOrder([comp('A', { formula: 'NOPE', order: 1 })])).toThrow(/unknown component/);
  });
});

describe('payroll engine', () => {
  it('full month: earnings and PF capped at the wage ceiling', () => {
    const r = computePayroll(base());
    expect(line(r.earnings, 'BASIC')).toBe(2_000_000);
    expect(line(r.earnings, 'HRA')).toBe(800_000);
    expect(r.gross).toBe(4_000_000);
    expect(line(r.deductions, 'PF')).toBe(180_000); // 12% of the 15,000 ceiling, though basic is 20,000
    expect(line(r.employerContributions, 'PF_ER')).toBe(180_000);
    expect(line(r.deductions, 'ESI')).toBeUndefined();
    expect(r.net).toBe(r.gross - r.totalDeductions);
  });

  it('prorates earnings by paid days and PF follows the prorated basic', () => {
    const r = computePayroll(base({ attendance: { totalDays: 30, paidDays: 15 }, components: [comp('BASIC', { fixedAmount: 20000, order: 1 })] }));
    expect(line(r.earnings, 'BASIC')).toBe(1_000_000);
    expect(line(r.deductions, 'PF')).toBe(120_000); // 12% of 10,000
  });

  it('records the full amount of prorated earnings, so LOP can be shown as a deduction', () => {
    const r = computePayroll(base({ attendance: { totalDays: 30, paidDays: 28 }, components: [comp('BASIC', { fixedAmount: 45000, order: 1 }), comp('CONV', { fixedAmount: 1600, prorate: false, order: 2 })] }));
    const basic = r.earnings.find((l) => l.code === 'BASIC')!;
    expect(basic.amount).toBe(4_200_000); // 45,000 x 28/30
    expect(basic.fullAmount).toBe(4_500_000);
    expect(r.earnings.find((l) => l.code === 'CONV')!.fullAmount).toBeUndefined();
    expect(computePayroll(base()).earnings.every((l) => l.fullAmount === undefined)).toBe(true); // no LOP, nothing to record
  });

  it('non-prorated components are paid in full; PF can be uncapped', () => {
    const r = computePayroll(
      base({
        attendance: { totalDays: 30, paidDays: 15 },
        components: [comp('BASIC', { fixedAmount: 20000, order: 1 }), comp('CONV', { fixedAmount: 1600, prorate: false, order: 2 })],
        statutory: { ...DEFAULT_STATUTORY, pf: { ...DEFAULT_STATUTORY.pf, capAtCeiling: false } },
      }),
    );
    expect(line(r.earnings, 'CONV')).toBe(160_000);
    expect(line(r.deductions, 'PF')).toBe(120_000);
  });

  it('PF can be switched off per employee', () => {
    expect(line(computePayroll(base({ employee: NO_STAT })).deductions, 'PF')).toBeUndefined();
  });

  it('ESI applies at or below the gross threshold and rounds up to the rupee', () => {
    const esi = { pfApplicable: false, esiApplicable: true, taxRegime: 'new' as const };
    const at = (rupees: number) => computePayroll(base({ components: [comp('BASIC', { fixedAmount: rupees, order: 1 })], employee: esi }));
    expect(line(at(18000).deductions, 'ESI')).toBe(13_500); // 0.75% of 18,000 = 135 exactly
    expect(line(at(18000).employerContributions, 'ESI_ER')).toBe(58_500); // 3.25% = 585
    expect(line(at(21000).deductions, 'ESI')).toBe(15_800); // 157.5 -> 158
    expect(line(at(21001).deductions, 'ESI')).toBeUndefined();
  });

  it('professional tax only in the configured months, by half-yearly slab', () => {
    expect(ptHalfYearly(20000, DEFAULT_STATUTORY.pt.slabs)).toBe(0);
    expect(ptHalfYearly(21001, DEFAULT_STATUTORY.pt.slabs)).toBe(135);
    expect(ptHalfYearly(250000, DEFAULT_STATUTORY.pt.slabs)).toBe(1250);
    expect(line(computePayroll(base({ month: '2026-09' })).deductions, 'PT')).toBe(125_000); // 40,000 x 6 = 2.4L
    expect(line(computePayroll(base({ month: '2026-10' })).deductions, 'PT')).toBeUndefined();
    expect(line(computePayroll(base({ month: '2027-03' })).deductions, 'PT')).toBe(125_000);
    // Only this month paid in the half-year (40,000 in total) -> the 45,000 slab
    expect(line(computePayroll(base({ month: '2026-09', halfYearGrossBefore: 0 })).deductions, 'PT')).toBe(31_500);
  });

  it('annual tax (new regime): nil under the rebate, slab maths above it', () => {
    const r = DEFAULT_STATUTORY.tds.newRegime;
    expect(annualTax(1_275_000, r, 0.04)).toBe(0); // 12.75L - 75k = 12L -> full rebate
    // 15L - 75k = 14.25L: 20k + 40k + 15% x 2.25L = 93,750; +4% cess = 97,500
    expect(annualTax(1_500_000, r, 0.04)).toBe(97_500);
  });

  it('TDS: none on small salaries, steady for steady pay, reduced by tax already deducted', () => {
    expect(line(computePayroll(base()).deductions, 'TDS')).toBeUndefined(); // 40k x 12 = 4.8L
    const high = base({ components: [comp('BASIC', { fixedAmount: 150000, order: 1 })], employee: NO_STAT });
    const first = line(computePayroll(high).deductions, 'TDS')!;
    expect(first).toBeGreaterThan(0);
    const nov = line(computePayroll({ ...high, month: '2026-11', ytd: { taxableIncome: 150000 * 100 * 7, tdsDeducted: first * 7 } }).deductions, 'TDS')!;
    expect(Math.abs(nov - first)).toBeLessThan(100);
    const overpaid = computePayroll({ ...high, month: '2026-11', ytd: { taxableIncome: 150000 * 100 * 7, tdsDeducted: first * 7 + 1_000_000 } });
    expect(line(overpaid.deductions, 'TDS') ?? 0).toBeLessThan(nov);
  });

  it('adds one-time items and loan EMI; warns when net goes negative', () => {
    const r = computePayroll(
      base({
        components: [comp('BASIC', { fixedAmount: 10000, order: 1 })],
        oneTime: [
          { code: 'BONUS', name: 'Bonus', kind: 'earning', amount: 500_000 },
          { code: 'ADV', name: 'Advance recovery', kind: 'deduction', amount: 100_000 },
        ],
        loanEmi: 200_000,
      }),
    );
    expect(r.gross).toBe(1_500_000);
    expect(line(r.deductions, 'LOAN')).toBe(200_000);
    expect(line(r.deductions, 'ADV')).toBe(100_000);
    const bad = computePayroll(base({ components: [comp('BASIC', { fixedAmount: 1000, order: 1 })], loanEmi: 500_000 }));
    expect(bad.warnings[0]).toMatch(/negative/);
  });

  it('is deterministic and rejects bad input', () => {
    expect(computePayroll(base())).toEqual(computePayroll(base()));
    expect(() => computePayroll(base({ attendance: { totalDays: 0, paidDays: 0 } }))).toThrow(PayrollError);
  });
});

describe('payslip presentation', () => {
  it('shows full earnings and an LOP deduction; net pay is unchanged', () => {
    const slip = {
      earnings: [{ code: 'BASIC', name: 'Basic', amount: 4_200_000, fullAmount: 4_500_000 }, { code: 'CONV', name: 'Conv', amount: 160_000 }],
      deductions: [{ code: 'PF', name: 'Provident Fund', amount: 180_000 }],
      gross: 4_360_000,
      totalDeductions: 180_000,
      attendance: { lopDays: 2 },
    };
    const v = presentPayslip(slip);
    expect(v.earnings.map((l) => l.amount)).toEqual([4_500_000, 160_000]);
    expect(v.deductions.at(-1)).toEqual({ code: 'LOP', name: 'LOP (2 days)', amount: 300_000 });
    expect(v.gross).toBe(4_660_000);
    expect(v.totalDeductions).toBe(480_000);
    expect(v.gross - v.totalDeductions).toBe(slip.gross - slip.totalDeductions); // same net
    expect(presentPayslip({ ...slip, attendance: { lopDays: 0.5 } }).deductions.at(-1)?.name).toBe('LOP (0.5 days)');
  });

  it('adds no LOP line when there was none (or the payslip predates full amounts)', () => {
    const noLop = { earnings: [{ code: 'BASIC', name: 'Basic', amount: 100 }], deductions: [{ code: 'PF', name: 'PF', amount: 10 }], gross: 100, totalDeductions: 10, attendance: { lopDays: 0 } };
    expect(presentPayslip(noLop).deductions).toHaveLength(1);
    expect(presentPayslip(noLop).gross).toBe(100);
    expect(presentPayslip({ ...noLop, attendance: { lopDays: 3 } }).deductions).toHaveLength(1); // old payslip: no fullAmount recorded
  });
});

describe('tax and professional tax when earlier months have no payslip', () => {
  const rich = (over: Partial<EngineInput> = {}) =>
    base({ components: [comp('BASIC', { fixedAmount: 250000, order: 1 })], employee: NO_STAT, ...over });

  it('TDS for someone already employed assumes the same pay for the earlier months (full-year projection)', () => {
    // 2.5L x 12 = 30L; new regime tax 4,57,500 + 4% cess = 4,75,800; a twelfth is 39,650
    const r = computePayroll(rich({ ytd: { taxableIncome: 0, tdsDeducted: 0, monthsCovered: 0, monthsEmployedBefore: 6 } }));
    expect(line(r.deductions, 'TDS')).toBe(3_965_000);
    // the same with no figures at all
    expect(line(computePayroll(rich()).deductions, 'TDS')).toBe(3_965_000);
  });

  it('a mid-year joiner is taxed only on the months actually worked', () => {
    // Joined this month (October): 6 months of pay = 15L; 15L - 75k = 14.25L -> 97,500 incl. cess; over 6 months = 16,250
    const r = computePayroll(rich({ ytd: { taxableIncome: 0, tdsDeducted: 0, monthsCovered: 0, monthsEmployedBefore: 0 } }));
    expect(line(r.deductions, 'TDS')).toBe(1_625_000);
  });

  it('covered months use the real figures; only the uncovered earlier months are assumed', () => {
    // Employed all 6 earlier months, 3 of them paid through the system (3 x 2.5L, 3 x 39,650 tax)
    const r = computePayroll(rich({ ytd: { taxableIncome: 3 * 25_000_000, tdsDeducted: 3 * 3_965_000, monthsCovered: 3, monthsEmployedBefore: 6 } }));
    expect(line(r.deductions, 'TDS')).toBe(3_965_000); // steady pay -> steady tax
  });

  it('professional tax uses the whole half-year even when earlier months have no payslip', () => {
    const pay = (over: Partial<EngineInput>) => line(computePayroll(base({ month: '2026-09', employee: NO_STAT, components: [comp('BASIC', { fixedAmount: 12000, order: 1 })], ...over })).deductions, 'PT');
    // 12,000 a month is 72,000 over the half-year -> the 75,000 slab (1,025); one month alone would be 12,000 -> nil
    expect(pay({ halfYearGrossBefore: 0, halfYearMissingMonths: 5 })).toBe(102_500);
    expect(pay({ halfYearGrossBefore: 0, halfYearMissingMonths: 0 })).toBeUndefined();
  });
});

