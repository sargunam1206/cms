import { z } from 'zod';

/**
 * Every kind of notification the system sends. `email` says whether it also goes by email by default
 * (only events that need someone to act). Each person can switch any of them off for themselves.
 */
export const NOTIFICATION_TYPES = [
  { key: 'leave.requested', label: 'A leave request is waiting for your decision', email: true },
  { key: 'leave.decided', label: 'Your leave request was approved or rejected', email: true },
  { key: 'regularization.requested', label: 'An attendance correction is waiting for your decision', email: true },
  { key: 'regularization.decided', label: 'Your attendance correction was approved or rejected', email: true },
  { key: 'bank_change.requested', label: 'An employee asked to change their bank details', email: true },
  { key: 'bank_change.decided', label: 'Your bank detail change was approved or rejected', email: true },
  { key: 'payroll.submitted', label: 'Payroll is waiting for your approval', email: true },
  { key: 'payroll.decided', label: 'Payroll you submitted was approved or sent back', email: true },
  { key: 'payslip.ready', label: 'Your payslip is ready', email: false },
  { key: 'task.assigned', label: 'A task was assigned to you', email: true },
  { key: 'task.created', label: 'A team member added a task to a project you lead', email: false },
  { key: 'task.comment', label: 'Someone commented on your task', email: false },
  { key: 'task.due_soon', label: 'A task of yours is due soon', email: true },
  { key: 'project.added', label: 'You were added to a project', email: false },
  { key: 'estimate.submitted', label: 'An estimate is waiting for your approval', email: true },
  { key: 'estimate.decided', label: 'Your estimate was approved or sent back', email: true },
  { key: 'milestone.late', label: 'A milestone you own is late or at risk', email: true },
  { key: 'enquiry.followup', label: 'An enquiry of yours is due for a follow-up', email: true },
  { key: 'idea.status', label: 'An idea of yours moved to a new stage', email: false },
  { key: 'idea.comment', label: 'Someone commented on your idea', email: false },
  { key: 'timesheet.submitted', label: 'A timesheet is waiting for your approval', email: true },
  { key: 'timesheet.decided', label: 'Your timesheet was approved or sent back', email: true },
  { key: 'meeting.invited', label: 'You were invited to a meeting, or it was changed', email: true },
  { key: 'meeting.cancelled', label: 'A meeting you were invited to was cancelled', email: true },
  { key: 'meeting.reminder', label: 'A meeting of yours starts soon', email: true },
  { key: 'meeting.action', label: 'A meeting action item was assigned to you', email: true },
  { key: 'intern.task', label: 'Intern work: a task was given to you, or your work was reviewed', email: true },
  { key: 'intern.submitted', label: 'An intern you mentor submitted work for review', email: true },
  { key: 'document.expiry', label: 'A confidential document is due for renewal or review', email: true },
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]['key'];
export const NOTIFICATION_KEYS = NOTIFICATION_TYPES.map((t) => t.key) as [NotificationType, ...NotificationType[]];

export const notificationPrefsSchema = z.object({
  /** Types the person does not want by email. */
  emailMuted: z.array(z.enum(NOTIFICATION_KEYS)).max(50),
  /** Types the person does not want in the bell. */
  inAppMuted: z.array(z.enum(NOTIFICATION_KEYS)).max(50),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;
