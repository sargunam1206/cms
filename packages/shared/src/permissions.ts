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

  TASKS_SELF: 'tasks.self', // work on the projects you belong to: your tasks, time, comments
  PROJECTS_VIEW: 'projects.view', // see every project, not just your own
  PROJECTS_MANAGE: 'projects.manage', // create clients and projects; edit projects you lead (or any, together with projects.view)

  ESTIMATES_VIEW: 'estimates.view', // see estimates with their rates and costs, and the variance reports
  ESTIMATES_MANAGE: 'estimates.manage', // draft and submit estimates, plan milestones (on projects you lead, or any with projects.view)
  ESTIMATES_APPROVE: 'estimates.approve', // approve estimates and set the rate card

  ENQUIRIES_SELF: 'enquiries.self', // work your own enquiries (sales leads)
  ENQUIRIES_VIEW: 'enquiries.view', // see every enquiry, read-only
  ENQUIRIES_MANAGE: 'enquiries.manage', // reassign, edit any enquiry, edit the dropdown values
  IDEAS_SELF: 'ideas.self', // submit, vote and comment on ideas
  IDEAS_MANAGE: 'ideas.manage', // move ideas through the pipeline
  MEETINGS_SELF: 'meetings.self', // schedule meetings and see the ones you organise or attend
  MEETINGS_MANAGE: 'meetings.manage', // see and edit every meeting
  CONFIDENTIAL_VIEW: 'confidential.view', // open the confidential documents area (every download is logged)
  CONFIDENTIAL_MANAGE: 'confidential.manage', // create folders, choose their editors, edit any confidential document
  INTERNS_MANAGE: 'interns.manage', // add interns, onboarding, documents, stipend, completion; see every intern
  INTERNS_MENTOR: 'interns.mentor', // mentor interns: allocate them to projects and give and review their work
  INTERN_SELF: 'intern.self', // an intern's own work board and internship record
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const ROLE_NAMES = ['Admin', 'HR', 'Management', 'Manager', 'Employee', 'Intern'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

const P = PERMISSIONS;
const SELF: Permission[] = [P.ATTENDANCE_SELF, P.LEAVE_SELF, P.TASKS_SELF, P.IDEAS_SELF, P.MEETINGS_SELF];

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
    P.PROJECTS_VIEW,
    P.ESTIMATES_VIEW,
    P.ENQUIRIES_VIEW,
    P.MEETINGS_MANAGE,
    P.CONFIDENTIAL_VIEW,
    P.INTERNS_MANAGE,
    P.INTERNS_MENTOR,
  ],
  Management: [...SELF, P.EMPLOYEES_VIEW, P.ATTENDANCE_TEAM, P.ATTENDANCE_ALL, P.AUDIT_VIEW, P.PAYROLL_VIEW, P.PAYROLL_APPROVE, P.PROJECTS_VIEW, P.PROJECTS_MANAGE, P.ESTIMATES_VIEW, P.ESTIMATES_MANAGE, P.ESTIMATES_APPROVE, P.ENQUIRIES_SELF, P.ENQUIRIES_VIEW, P.ENQUIRIES_MANAGE, P.IDEAS_MANAGE, P.MEETINGS_MANAGE, P.CONFIDENTIAL_VIEW, P.CONFIDENTIAL_MANAGE, P.INTERNS_MANAGE, P.INTERNS_MENTOR],
  Manager: [...SELF, P.ATTENDANCE_TEAM, P.REGULARIZATION_APPROVE, P.LEAVE_APPROVE, P.PROJECTS_MANAGE, P.ESTIMATES_MANAGE, P.ENQUIRIES_SELF, P.INTERNS_MENTOR],
  Employee: [...SELF, P.ENQUIRIES_SELF], // anyone can log a sales lead; they only ever see their own
  // interns: attendance, leave, timesheet, meetings, ideas, their own sales leads and their work board; no payroll
  Intern: [...SELF, P.INTERN_SELF, P.ENQUIRIES_SELF],
};

/** Permissions introduced in Phase 3. The seed adds them (once) to existing roles that should have them by default. */
export const PHASE3_PERMISSIONS: Permission[] = [P.TASKS_SELF, P.PROJECTS_VIEW, P.PROJECTS_MANAGE];

/** Permissions introduced in Phase 4, added once to existing roles by the seed. */
export const PHASE4_PERMISSIONS: Permission[] = [P.ESTIMATES_VIEW, P.ESTIMATES_MANAGE, P.ESTIMATES_APPROVE];

/** Permissions introduced in Phase 5, added once to existing roles by the seed. */
export const PHASE5_PERMISSIONS: Permission[] = [P.ENQUIRIES_SELF, P.ENQUIRIES_VIEW, P.ENQUIRIES_MANAGE, P.IDEAS_SELF, P.IDEAS_MANAGE];

/** Meeting tracker permissions, added once to existing roles by the seed. */
export const MEETING_PERMISSIONS: Permission[] = [P.MEETINGS_SELF, P.MEETINGS_MANAGE];

/** Confidential documents permissions, added once to existing roles by the seed. */
export const CONFIDENTIAL_PERMISSIONS: Permission[] = [P.CONFIDENTIAL_VIEW, P.CONFIDENTIAL_MANAGE];

/** Intern permissions, added once to existing roles by the seed. */
export const INTERN_PERMISSIONS: Permission[] = [P.INTERNS_MANAGE, P.INTERNS_MENTOR, P.INTERN_SELF];
