import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUTORY } from '@cms/shared';
import { annualTax, computePayroll, PayrollError, ptHalfYearly, resolveOrder, type EngineComponent, type EngineInput } from './engine';
import { evaluateFormula, formulaDependencies } from './formula';

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
