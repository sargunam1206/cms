import { z } from 'zod';
import { objectId } from './schemas';

export const PROJECT_STATUS = ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;
export const BILLING_TYPES = ['fixed', 'time_material', 'internal'] as const;
export const TASK_STATUS = ['todo', 'in_progress', 'in_review', 'done', 'blocked'] as const;
export const TASK_PRIORITY = ['low', 'medium', 'high', 'urgent'] as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[number];
export type TaskStatus = (typeof TASK_STATUS)[number];
export type TaskPriority = (typeof TASK_PRIORITY)[number];

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));
const dateOrBlank = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().or(z.literal(''));

export const clientSchema = z.object({
  name: z.string().trim().min(2, 'Client name is required').max(120),
  contactName: optionalText(80),
  email: z.string().trim().email('Enter a valid email').max(120).optional().or(z.literal('')),
  phone: optionalText(30),
  address: optionalText(300),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN should look like 33ABCDE1234F1Z5')
    .optional()
    .or(z.literal('')),
  notes: optionalText(500),
  active: z.boolean().default(true),
});
export type ClientInput = z.infer<typeof clientSchema>;

export const projectSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9-]{1,19}$/, 'Use capitals, digits and - (e.g. PRJ-001)'),
    name: z.string().trim().min(2, 'Project name is required').max(120),
    client: objectId.nullable().optional().or(z.literal('')),
    manager: objectId, // the employee who leads the project
    members: z.array(objectId).max(200).default([]),
    status: z.enum(PROJECT_STATUS).default('planning'),
    billingType: z.enum(BILLING_TYPES).default('time_material'),
    startDate: dateOrBlank,
    dueDate: dateOrBlank,
    budgetHours: z.number().min(0).max(1_000_000).optional(),
    description: optionalText(2000),
  })
  .refine((p) => !p.startDate || !p.dueDate || p.startDate <= p.dueDate, { message: 'Due date cannot be before the start date', path: ['dueDate'] });
export type ProjectInput = z.infer<typeof projectSchema>;

export const taskSchema = z.object({
  title: z.string().trim().min(2, 'Give the task a title').max(160),
  description: optionalText(4000),
  assignee: objectId.nullable().optional().or(z.literal('')),
  status: z.enum(TASK_STATUS).default('todo'),
  priority: z.enum(TASK_PRIORITY).default('medium'),
  estimateHours: z.number().min(0).max(10_000).optional(),
  dueDate: dateOrBlank,
  /** Optional: the milestone this task counts towards. */
  milestone: objectId.nullable().optional().or(z.literal('')),
  /** Optional: the module of the approved estimate this task belongs to, so actual hours can be compared per module. */
  estimateModule: z.string().trim().max(100).nullable().optional().or(z.literal('')),
});
export type TaskInput = z.infer<typeof taskSchema>;

/** What an assignee (who cannot edit the task itself) may change. */
export const taskStatusSchema = z.object({
  status: z.enum(TASK_STATUS),
  /** Position within the new column (0 = top); used by the board when a card is dropped. */
  position: z.number().int().min(0).max(10_000).optional(),
});
export const taskCommentSchema = z.object({ text: z.string().trim().min(1, 'Write a comment').max(2000) });

// ---------- Time logs and timesheets ----------
export const timesheetRulesSchema = z.object({
  /** When on, a week's logs are locked once submitted, until a manager approves or sends it back. */
  requireApproval: z.boolean(),
  /** Minutes allowed above the hours attendance shows (breaks, rounding). */
  toleranceMinutes: z.number().int().min(0).max(240),
});
export type TimesheetRules = z.infer<typeof timesheetRulesSchema>;
export const DEFAULT_TIMESHEET_RULES: TimesheetRules = { requireApproval: false, toleranceMinutes: 30 };

const dateStrict = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const timeLogSchema = z.object({
  task: objectId,
  date: dateStrict,
  /** Total minutes on this task that day; 0 removes the entry. */
  minutes: z.number().int().min(0).max(1440),
  note: z.string().trim().max(300).optional(),
});
export type TimeLogInput = z.infer<typeof timeLogSchema>;
export const weekQuerySchema = z.object({ start: dateStrict.optional(), employee: objectId.optional() });
export const submitWeekSchema = z.object({ weekStart: dateStrict });
export const timesheetDecisionSchema = z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().trim().max(500).optional() });

/** Kinds of project document, for grouping and filtering. */
export const PROJECT_DOC_CATEGORIES = ['brief', 'requirement', 'design', 'drawing', 'contract', 'quotation', 'report', 'minutes', 'other'] as const;
export const PROJECT_DOC_CATEGORY_LABEL: Record<(typeof PROJECT_DOC_CATEGORIES)[number], string> = {
  brief: 'Brief / explanation',
  requirement: 'Requirements',
  design: 'Design',
  drawing: 'Drawing',
  contract: 'Contract / agreement',
  quotation: 'Quotation / estimate',
  report: 'Report',
  minutes: 'Minutes',
  other: 'Other',
};
export const projectDocSchema = z.object({
  title: z.string().trim().min(2, 'Give the document a title').max(150),
  category: z.enum(PROJECT_DOC_CATEGORIES).default('other'),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  task: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional().or(z.literal('')),
});
