import type { StatutorySettings } from '@cms/shared';

export interface PayComponent {
  _id: string;
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  taxable: boolean;
  prorate: boolean;
  order: number;
  active: boolean;
}

export interface PayLine {
  code: string;
  fixedAmount?: number;
  formula?: string;
}

export interface PayTemplate {
  _id: string;
  name: string;
  lines: PayLine[];
}

export interface PayStructure {
  _id: string;
  effectiveFrom: string;
  lines: PayLine[];
}

export interface PayLineResult {
  code: string;
  name: string;
  amount: number; // paise
  note?: string;
}

export interface Preview {
  month: string;
  employee: { name: string; code: string };
  earnings: PayLineResult[];
  deductions: PayLineResult[];
  employerContributions: PayLineResult[];
  gross: number;
  totalDeductions: number;
  net: number;
  paidDays: number;
  totalDays: number;
  warnings: string[];
}

export type Statutory = StatutorySettings;

/** Paise to a rupee string with Indian digit grouping. */
export const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
