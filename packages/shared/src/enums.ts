export const ATTENDANCE_STATUS = ['present', 'half', 'absent', 'leave', 'holiday', 'weekoff'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[number];

export const ATTENDANCE_SOURCE = ['self', 'regularized', 'system', 'leave', 'override'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCE)[number];

export const REQUEST_STATUS = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUS)[number];

export const REGULARIZATION_TYPES = ['missed-checkin', 'missed-checkout', 'on-duty'] as const;
export type RegularizationType = (typeof REGULARIZATION_TYPES)[number];

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];
export const EMPLOYEE_STATUS = ['active', 'notice', 'exited'] as const;
/** Employees and interns share the employee record (attendance, leave, timesheets); interns are kept out of payroll. */
export const EMPLOYEE_TYPES = ['employee', 'intern'] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];
export type EmployeeStatus = (typeof EMPLOYEE_STATUS)[number];

export const TAX_REGIMES = ['new', 'old'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** Saturday handling: every Saturday is working, every Saturday off, or only listed weeks off (e.g. 2nd & 4th). */
export const SATURDAY_RULES = ['working', 'off', 'alternate'] as const;
export type SaturdayRule = (typeof SATURDAY_RULES)[number];

export const LEAVE_ACCRUAL = ['yearly', 'monthly'] as const;
export type LeaveAccrual = (typeof LEAVE_ACCRUAL)[number];
