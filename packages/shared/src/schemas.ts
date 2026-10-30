import { z } from 'zod';
import {
  EMPLOYEE_STATUS,
  LEAVE_ACCRUAL,
  REGULARIZATION_TYPES,
  SATURDAY_RULES,
  TAX_REGIMES,
  GENDERS,
} from './enums';
import { ALL_PERMISSIONS, type Permission } from './permissions';

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const monthStr = z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

// ---------- Auth ----------
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'At least 8 characters'),
});

export const forgotPasswordSchema = z.object({ email: z.string().email() });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(8, 'At least 8 characters'),
});

// ---------- Roles / users ----------
export const roleSchema = z.object({
  name: z.string().min(2).max(50),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])),
});
export type RoleInput = z.infer<typeof roleSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: objectId,
  employee: objectId.optional(),
});
export const updateUserSchema = z.object({
  role: objectId.optional(),
  employee: objectId.nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  password: z.string().min(8).optional(),
});

// ---------- Employees ----------
export const employeeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(20).optional(),
  department: z.string().max(60).optional(),
  designation: z.string().max(60).optional(),
  manager: objectId.nullable().optional().or(z.literal('')),
  dateOfJoining: dateStr,
  dateOfBirth: dateStr.optional().or(z.literal('')),
  gender: z.enum(GENDERS).or(z.literal('')).nullish(),
  branch: z.string().max(80).nullish(),
  pan: z.string().max(10).optional(),
  uan: z.string().max(12).optional(),
  esiNumber: z.string().max(17).optional(),
  bank: z
    .object({
      accountNumber: z.string().max(20).optional(),
      ifsc: z.string().max(11).optional(),
      bankName: z.string().max(60).optional(),
    })
    .optional(),
  pfApplicable: z.boolean().default(true),
  esiApplicable: z.boolean().default(false),
  taxRegime: z.enum(TAX_REGIMES).default('new'),
  status: z.enum(EMPLOYEE_STATUS).default('active'),
  exitDate: dateStr.optional().or(z.literal('')),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

// ---------- Settings ----------
export const workCalendarSchema = z.object({
  weeklyOffs: z.array(z.number().int().min(0).max(6)), // 0 = Sunday
  saturdayRule: z.enum(SATURDAY_RULES),
  saturdaysOff: z.array(z.number().int().min(1).max(5)), // used when saturdayRule = 'alternate'
  shiftStart: timeStr,
  shiftEnd: timeStr,
  graceMinutes: z.number().int().min(0).max(240),
  lateLopEnabled: z.boolean(), // off = late marks are still recorded but never reduce pay
  lateMarksPerHalfDay: z.number().int().min(1).max(31), // every N (non-excused) late marks = ½ day LOP
  lateFreeAllowance: z.number().int().min(0).max(31), // first N late marks each month are ignored before the rule applies
  minHoursFullDay: z.number().min(0).max(24),
  minHoursHalfDay: z.number().min(0).max(24),
});
export type WorkCalendarSettings = z.infer<typeof workCalendarSchema>;

export const DEFAULT_WORK_CALENDAR: WorkCalendarSettings = {
  weeklyOffs: [0],
  saturdayRule: 'working',
  saturdaysOff: [2, 4],
  shiftStart: '09:30',
  shiftEnd: '18:30',
  graceMinutes: 15,
  lateLopEnabled: true,
  lateMarksPerHalfDay: 3,
  lateFreeAllowance: 0,
  minHoursFullDay: 8,
  minHoursHalfDay: 4,
};

// ---------- Holidays ----------
export const holidaySchema = z.object({
  date: dateStr,
  name: z.string().min(1).max(100),
  optional: z.boolean().default(false),
});

// ---------- Attendance ----------
export const regularizationSchema = z
  .object({
    date: dateStr,
    type: z.enum(REGULARIZATION_TYPES),
    checkIn: timeStr.optional().or(z.literal('')),
    checkOut: timeStr.optional().or(z.literal('')),
    reason: z.string().min(5).max(500),
  })
  .refine((v) => v.checkIn || v.checkOut, { message: 'Provide check-in and/or check-out time', path: ['checkIn'] });
export type RegularizationInput = z.infer<typeof regularizationSchema>;

/** HR/Admin direct correction. Times are optional, but if given both are required. */
const overrideFields = {
  status: z.enum(['present', 'half', 'absent']),
  checkIn: timeStr.optional().or(z.literal('')),
  checkOut: timeStr.optional().or(z.literal('')),
  reason: z.string().min(5, 'Give a reason (at least 5 characters)').max(500),
};
type OverrideTimes = { checkIn?: string; checkOut?: string };
const hasBothTimesOrNone = (v: OverrideTimes) => !!v.checkIn === !!v.checkOut;
const checkOutIsAfterIn = (v: OverrideTimes) => !v.checkIn || !v.checkOut || v.checkOut > v.checkIn;
const BOTH_TIMES_MSG = { message: 'Provide both check-in and check-out, or neither', path: ['checkIn'] };
const TIMES_ORDER_MSG = { message: 'Check-out must be after check-in', path: ['checkOut'] };

export const attendanceOverrideSchema = z
  .object({ employee: objectId, date: dateStr, ...overrideFields })
  .refine(hasBothTimesOrNone, BOTH_TIMES_MSG)
  .refine(checkOutIsAfterIn, TIMES_ORDER_MSG);
export type AttendanceOverrideInput = z.infer<typeof attendanceOverrideSchema>;

/** Same correction for many employees over a date range. `dryRun` returns the outcome without writing. */
export const BULK_OVERRIDE_MAX_DAYS = 62;
export const attendanceBulkOverrideSchema = z
  .object({
    employees: z.array(objectId).min(1, 'Select at least one employee').max(500),
    from: dateStr,
    to: dateStr,
    ...overrideFields,
    dryRun: z.boolean().optional(),
  })
  .refine((v) => v.from <= v.to, { message: '"from" must be on or before "to"', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 < BULK_OVERRIDE_MAX_DAYS, {
    message: `Choose at most ${BULK_OVERRIDE_MAX_DAYS} days at a time`,
    path: ['to'],
  })
  .refine(hasBothTimesOrNone, BOTH_TIMES_MSG)
  .refine(checkOutIsAfterIn, TIMES_ORDER_MSG);
export type AttendanceBulkOverrideInput = z.infer<typeof attendanceBulkOverrideSchema>;

/** HR/Admin: excuse (or restore) late marks on given days so they do not count towards late-mark LOP. */
export const attendanceLateReliefSchema = z.object({
  employee: objectId,
  dates: z.array(dateStr).min(1, 'Pick at least one day').max(31),
  excused: z.boolean(),
  reason: z.string().min(5, 'Give a reason (at least 5 characters)').max(500),
});
export type AttendanceLateReliefInput = z.infer<typeof attendanceLateReliefSchema>;

export const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(500).optional(),
});

// ---------- Own profile ----------
export const contactUpdateSchema = z.object({
  phone: z.string().trim().regex(/^[0-9+\-\s]{7,15}$/, 'Enter a valid phone number'),
});
export const bankChangeSchema = z.object({
  accountNumber: z.string().trim().regex(/^[0-9]{6,20}$/, 'Account number must be 6-20 digits'),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC (e.g. SBIN0001234)'),
  bankName: z.string().trim().min(2).max(60),
});

export const unlockSchema = z.object({ reason: z.string().min(5).max(500) });

// ---------- Leave ----------
export const leaveTypeSchema = z.object({
  code: z.string().min(1).max(10).toUpperCase(),
  name: z.string().min(1).max(50),
  paid: z.boolean().default(true),
  annualQuota: z.number().min(0).max(365),
  accrual: z.enum(LEAVE_ACCRUAL).default('yearly'),
  carryForwardMax: z.number().min(0).max(365).default(0),
  encashable: z.boolean().default(false),
  allowHalfDay: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;

export const leaveRequestSchema = z
  .object({
    leaveType: objectId,
    from: dateStr,
    to: dateStr,
    halfDay: z.boolean().default(false),
    reason: z.string().min(3).max(500),
  })
  .refine((v) => v.from <= v.to, { message: '"from" must be on or before "to"', path: ['to'] })
  .refine((v) => !v.halfDay || v.from === v.to, { message: 'Half day must be a single date', path: ['halfDay'] });
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

export const balanceAdjustSchema = z.object({
  employee: objectId,
  leaveType: objectId,
  year: z.number().int(),
  delta: z.number(),
  reason: z.string().min(3),
});
