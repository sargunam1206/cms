export const PERMISSIONS = {
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',

  EMPLOYEES_VIEW: 'employees.view',
  EMPLOYEES_MANAGE: 'employees.manage',

  ATTENDANCE_SELF: 'attendance.self',
  ATTENDANCE_TEAM: 'attendance.team',
  ATTENDANCE_ALL: 'attendance.all',
  ATTENDANCE_LOCK: 'attendance.lock',
  ATTENDANCE_OVERRIDE: 'attendance.override',

  REGULARIZATION_APPROVE: 'regularization.approve',

  LEAVE_SELF: 'leave.self',
  LEAVE_APPROVE: 'leave.approve',
  LEAVE_MANAGE: 'leave.manage',

  HOLIDAYS_MANAGE: 'holidays.manage',

  PAYROLL_VIEW: 'payroll.view',
  PAYROLL_MANAGE: 'payroll.manage',
  PAYROLL_APPROVE: 'payroll.approve',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const ROLE_NAMES = ['Admin', 'HR', 'Management', 'Manager', 'Employee'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

const P = PERMISSIONS;
const SELF: Permission[] = [P.ATTENDANCE_SELF, P.LEAVE_SELF];

/** Seeded defaults; roles are editable afterwards from the Roles screen. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  Admin: ALL_PERMISSIONS,
  HR: [
    ...SELF,
    P.EMPLOYEES_VIEW,
    P.EMPLOYEES_MANAGE,
    P.ATTENDANCE_TEAM,
    P.ATTENDANCE_ALL,
    P.ATTENDANCE_LOCK,
    P.ATTENDANCE_OVERRIDE,
    P.REGULARIZATION_APPROVE,
    P.LEAVE_APPROVE,
    P.LEAVE_MANAGE,
    P.HOLIDAYS_MANAGE,
    P.SETTINGS_MANAGE,
    P.PAYROLL_VIEW,
    P.PAYROLL_MANAGE,
  ],
  Management: [...SELF, P.EMPLOYEES_VIEW, P.ATTENDANCE_TEAM, P.ATTENDANCE_ALL, P.AUDIT_VIEW, P.PAYROLL_VIEW, P.PAYROLL_APPROVE],
  Manager: [...SELF, P.ATTENDANCE_TEAM, P.REGULARIZATION_APPROVE, P.LEAVE_APPROVE],
  Employee: SELF,
};
