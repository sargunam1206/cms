import { describe, expect, it } from 'vitest';
import { accruedFor, availableBalance, carryForwardAmount } from './rules';

describe('accruedFor', () => {
  it('yearly: full quota for existing staff', () => {
    expect(accruedFor({ annualQuota: 12, accrual: 'yearly' }, 2026, '2020-05-01', '2026-02-10')).toBe(12);
  });
  it('yearly: prorated for a mid-year joiner', () => {
    expect(accruedFor({ annualQuota: 12, accrual: 'yearly' }, 2026, '2026-07-15', '2026-08-01')).toBe(6);
  });
  it('monthly: credits each month of service so far', () => {
    expect(accruedFor({ annualQuota: 15, accrual: 'monthly' }, 2026, '2020-01-01', '2026-04-10')).toBe(5);
    expect(accruedFor({ annualQuota: 15, accrual: 'monthly' }, 2025, '2020-01-01', '2026-04-10')).toBe(15);
  });
  it('nothing before joining', () => {
    expect(accruedFor({ annualQuota: 12, accrual: 'yearly' }, 2025, '2026-01-01', '2026-04-10')).toBe(0);
  });
});

describe('balance helpers', () => {
  it('available = opening + accrued + adjustment - used - encashed - pending', () => {
    expect(availableBalance({ opening: 5, accrued: 12, adjustment: 1, used: 4, encashed: 2, pending: 1 })).toBe(11);
  });
  it('carry forward is capped', () => {
    expect(carryForwardAmount(40, 30)).toBe(30);
    expect(carryForwardAmount(-1, 30)).toBe(0);
  });
});
