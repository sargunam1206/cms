import type { AttendanceStatus, Permission, RequestStatus } from '@cms/shared';

export interface Me {
  id: string;
  email: string;
  role: string;
  permissions: Permission[];
  employee: { _id: string; code: string; name: string; designation?: string; department?: string } | null;
}

export interface EmployeeRef {
  _id: string;
  name: string;
  code: string;
}

export interface Employee extends EmployeeRef {
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
  manager?: EmployeeRef | null;
  dateOfJoining: string;
  dateOfBirth?: string;
  pan?: string;
  uan?: string;
  esiNumber?: string;
  bank?: { accountNumber?: string; ifsc?: string; bankName?: string };
  pfApplicable: boolean;
  esiApplicable: boolean;
  taxRegime: 'new' | 'old';
  status: 'active' | 'notice' | 'exited';
  exitDate?: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AttendanceRecord {
  _id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  isLate: boolean;
  lateExcused?: { reason?: string } | null;
  status: AttendanceStatus;
  source: string;
  missedCheckout: boolean;
}

export interface MonthDay {
  date: string;
  type: 'working' | 'weekoff' | 'holiday' | 'inactive';
  status?: AttendanceStatus;
  isLate?: boolean;
  lateExcused?: boolean;
  open?: boolean;
  leave: { paid: boolean; fraction: number; code?: string } | null;
  record?: AttendanceRecord | null;
}

export interface AttendanceSummary {
  totalDays: number;
  workingDays: number;
  holidays: number;
  weekoffs: number;
  inactiveDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  lateCount: number;
  lateExcusedCount: number;
  latePenaltyDays: number;
  lopDays: number;
  paidDays: number;
  pendingDays: number;
}

export interface EmployeeMonth {
  employee: EmployeeRef;
  month: string;
  locked: boolean;
  days: MonthDay[];
  summary: AttendanceSummary;
}

export interface Register {
  month: string;
  dates: string[];
  total: number;
  page: number;
  limit: number;
  locked: boolean;
  rows: { employee: EmployeeRef & { department?: string }; days: MonthDay[]; summary: AttendanceSummary }[];
}

export interface BulkOverrideResult {
  dryRun: boolean;
  days: number;
  people: number;
  updated: number;
  skippedCount: number;
  skippedByReason: Record<string, number>;
  skipped: { employee: EmployeeRef; date: string; reason: string }[];
}

export interface Today {
  serverTime: string;
  date: string;
  dayType: string;
  shift: { start: string; end: string };
  record: AttendanceRecord | null;
}

export interface Regularization {
  _id: string;
  employee: string | EmployeeRef;
  date: string;
  type: string;
  checkIn?: string;
  checkOut?: string;
  reason: string;
  status: RequestStatus;
  comment?: string;
  createdAt: string;
}

export interface LeaveType {
  _id: string;
  code: string;
  name: string;
  paid: boolean;
  annualQuota: number;
  accrual: 'yearly' | 'monthly';
  carryForwardMax: number;
  encashable: boolean;
  allowHalfDay: boolean;
  active: boolean;
}

export interface LeaveBalance {
  leaveType: { _id: string; code: string; name: string; paid: boolean };
  year: number;
  opening: number;
  accrued: number;
  adjustment: number;
  used: number;
  encashed: number;
  pending: number;
  available: number;
}

export interface LeaveRequest {
  _id: string;
  employee: string | EmployeeRef;
  leaveType: { _id: string; code: string; name: string };
  from: string;
  to: string;
  halfDay: boolean;
  days: number;
  reason: string;
  status: RequestStatus;
  comment?: string;
}

export interface Holiday {
  _id: string;
  date: string;
  name: string;
  optional: boolean;
}

export interface Role {
  _id: string;
  name: string;
  permissions: Permission[];
  system: boolean;
}

export interface UserRow {
  _id: string;
  email: string;
  role: { _id: string; name: string };
  employee: EmployeeRef | null;
  status: 'active' | 'disabled';
  lastLoginAt?: string;
}

export interface AttendanceLock {
  _id: string;
  month: string;
  locked: boolean;
  history: { action: 'lock' | 'unlock'; by: { email: string }; at: string; reason?: string }[];
}

export interface AuditEntry {
  _id: string;
  actor?: { email: string };
  action: string;
  entity: string;
  entityId?: string;
  meta?: unknown;
  createdAt: string;
}
