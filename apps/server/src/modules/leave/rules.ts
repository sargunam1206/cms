/** Pure leave calculations. */
import type { LeaveAccrual } from '@cms/shared';

/** Leave is granted in half-day steps; accruals round down. */
export const floorHalf = (n: number) => Math.floor(n * 2) / 2;

/**
 * Leave accrued in `year` as of `asOf` (YYYY-MM-DD).
 * - yearly: full quota on 1 Jan, prorated by remaining months for a mid-year joiner
 * - monthly: quota/12 credited at the start of each month of service
 */
export function accruedFor(
  type: { annualQuota: number; accrual: LeaveAccrual },
  year: number,
  dateOfJoining: string,
  asOf: string,
): number {
  const asOfYear = Number(asOf.slice(0, 4));
  const joinYear = Number(dateOfJoining.slice(0, 4));
  if (year < joinYear || year > asOfYear) return 0;

  const startMonth = joinYear === year ? Number(dateOfJoining.slice(5, 7)) : 1; // 1-12
  if (type.accrual === 'yearly') {
    return floorHalf((type.annualQuota * (13 - startMonth)) / 12);
  }
  const endMonth = asOfYear === year ? Number(asOf.slice(5, 7)) : 12;
  const months = Math.max(0, endMonth - startMonth + 1);
  return floorHalf((type.annualQuota / 12) * months);
}

export interface BalanceParts {
  opening: number;
  accrued: number;
  adjustment: number;
  used: number;
  encashed: number;
  pending: number;
}

export const availableBalance = (b: BalanceParts) => b.opening + b.accrued + b.adjustment - b.used - b.encashed - b.pending;

export const carryForwardAmount = (remaining: number, max: number) => Math.max(0, Math.min(remaining, max));
