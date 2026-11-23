import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

export const INTERN_STATUS = ['onboarding', 'active', 'completed', 'dropped', 'converted'] as const;
export type InternStatus = (typeof INTERN_STATUS)[number];

/** Starting onboarding checklist for every new intern; HR can add or remove items per intern. */
export const DEFAULT_INTERN_CHECKLIST = [
  'Offer letter sent',
  'Offer letter signed and returned',
  'College letter / NOC received',
  'ID proof collected',
  'NDA / confidentiality signed',
  'Login and email created',
  'Laptop / workstation ready',
  'ID card issued',
  'Induction and orientation done',
  'Mentor introduced',
];

const internFields = {
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  phone: optText(20),
  department: optText(80),
  designation: optText(80),
  college: z.string().trim().min(2, 'College is required').max(150),
  course: optText(100),
  yearOfStudy: optText(30),
  startDate: day,
  endDate: day,
  mentor: id.nullable().optional().or(z.literal('')),
  /** Monthly stipend in rupees (0 for unpaid). */
  stipend: z.coerce.number().min(0).max(1_000_000).default(0),
};

export const internSchema = z
  .object({
    code: z.string().trim().min(2).max(30),
    ...internFields,
    /** Set to create a login (Intern role) at the same time; needs an email. */
    password: z.string().min(8, 'At least 8 characters').max(100).optional().or(z.literal('')),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] })
  .refine((v) => !v.password || !!v.email, { message: 'An email is needed to create a login', path: ['email'] });
export type InternInput = z.infer<typeof internSchema>;

export const internUpdateSchema = z
  .object(internFields)
  .refine((v) => v.endDate >= v.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });
export type InternUpdate = z.infer<typeof internUpdateSchema>;

export const internStatusSchema = z.object({
  status: z.enum(INTERN_STATUS),
  /** On completion: a rating 1-5, feedback and whether a certificate was issued. */
  rating: z.coerce.number().int().min(1).max(5).optional(),
  feedback: optText(2000),
  certificateIssued: z.boolean().optional(),
  date: day.optional(),
});

export const internChecklistSchema = z.object({
  items: z.array(z.object({ label: z.string().trim().min(1).max(120), done: z.boolean(), note: optText(300) })).max(40),
});

export const stipendPaymentSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM'),
  amount: z.coerce.number().min(0).max(1_000_000), // rupees
  paidOn: day,
  note: optText(200),
});

export const internAllocationSchema = z
  .object({
    project: id,
    from: day,
    to: day.optional().or(z.literal('')),
    note: optText(300),
  })
  .refine((v) => !v.to || v.to >= v.from, { message: 'End must be on or after the start', path: ['to'] });

export const INTERN_TASK_KINDS = ['learning', 'project'] as const;
export const INTERN_TASK_STATUS = ['assigned', 'in_progress', 'submitted', 'approved', 'redo'] as const;
export type InternTaskStatus = (typeof INTERN_TASK_STATUS)[number];

export const internTaskSchema = z.object({
  title: z.string().trim().min(2).max(150),
  description: optText(3000),
  kind: z.enum(INTERN_TASK_KINDS).default('learning'),
  project: id.nullable().optional().or(z.literal('')),
  dueDate: day.nullable().optional().or(z.literal('')),
  estimateHours: z.coerce.number().min(0).max(1000).optional(),
});

export const internLogSchema = z.object({
  date: day,
  minutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(16 * 60),
  note: z.string().trim().min(2, 'Say what you did').max(1000),
});

/** The intern starts or submits a task; the mentor approves or asks for a redo, with feedback. */
export const internTaskStatusSchema = z.object({
  status: z.enum(INTERN_TASK_STATUS),
  note: optText(1000),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
