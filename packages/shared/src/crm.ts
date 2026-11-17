import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/** The two statuses that close an enquiry. They are fixed; the stages before them are editable. */
export const WON = 'Won';
export const LOST = 'Lost';

/** Admin-managed dropdown values. Placeholders until the company sets its own. */
export const enquiryOptionsSchema = z.object({
  sources: z.array(z.string().trim().min(1).max(40)).min(1).max(30),
  /** Open stages in order, first one is where new enquiries start. Won and Lost are always available. */
  stages: z.array(z.string().trim().min(1).max(40)).min(1).max(15),
  lostReasons: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
});
export type EnquiryOptions = z.infer<typeof enquiryOptionsSchema>;
export const DEFAULT_ENQUIRY_OPTIONS: EnquiryOptions = {
  sources: ['Website', 'Referral', 'Phone call', 'Walk-in', 'Social media', 'Exhibition'],
  stages: ['New', 'Contacted', 'Proposal sent', 'Negotiation'],
  lostReasons: ['Price', 'Timing', 'Chose a competitor', 'No response', 'Not a fit'],
};

/** Indian mobile/landline numbers compared by their last ten digits, so +91, spaces and dashes do not hide a duplicate. */
export function phoneKey(raw: string) {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

const phone = z
  .string()
  .trim()
  .max(30)
  .refine((v) => phoneKey(v).length === 10, 'Enter a 10-digit phone number');

export const enquirySchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone,
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  company: z.string().trim().max(120).optional().or(z.literal('')),
  source: z.string().trim().min(1, 'Pick a source').max(40),
  /** Where it starts; defaults to the first stage. */
  status: z.string().trim().max(40).optional(),
  nextFollowUp: day,
  /** Only people who manage enquiries can start one on someone else's name. */
  owner: id.optional(),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
});
export type EnquiryInput = z.infer<typeof enquirySchema>;

export const enquiryUpdateSchema = enquirySchema.omit({ status: true, note: true }).partial();

export const enquiryStatusSchema = z.object({
  status: z.string().trim().min(1).max(40),
  /** Required to move to Lost. */
  lostReason: z.string().trim().max(60).optional(),
  /** Required for any open stage. */
  nextFollowUp: day.optional(),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
});

export const enquiryNoteSchema = z.object({ text: z.string().trim().min(1, 'Write a note').max(2000), nextFollowUp: day.optional() });

export const enquiryConvertSchema = z.object({
  projectCode: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9-]{1,19}$/, 'Use capitals, digits and - (e.g. PRJ-001)'),
  projectName: z.string().trim().min(2).max(120),
  manager: id,
  /** Use an existing client instead of creating one from the enquiry. */
  client: id.optional(),
  billingType: z.enum(['fixed', 'time_material', 'internal']).default('time_material'),
});

// ---------- Innovation hub ----------
export const IDEA_STATUS = ['submitted', 'under_review', 'approved', 'in_progress', 'done', 'declined'] as const;
export type IdeaStatus = (typeof IDEA_STATUS)[number];

export const ideaSchema = z.object({
  title: z.string().trim().min(4, 'Give the idea a title').max(140),
  description: z.string().trim().min(10, 'Describe the idea in a sentence or two').max(4000),
  tags: z.array(z.string().trim().min(1).max(30)).max(6).default([]),
});
export const ideaStatusSchema = z.object({
  status: z.enum(IDEA_STATUS),
  /** Required when declining. */
  comment: z.string().trim().max(500).optional().or(z.literal('')),
  project: id.nullable().optional(),
});
export const ideaCommentSchema = z.object({ text: z.string().trim().min(1, 'Write a comment').max(2000), parent: id.optional() });
