import { z } from 'zod';

export const ESTIMATE_STATUS = ['draft', 'submitted', 'approved', 'rejected', 'superseded'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUS)[number];

/** Rates are per hour, in integer paise. */
export const rateCardSchema = z.object({
  roles: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(60),
        costRate: z.number().int().min(0).max(100_000_00),
        billingRate: z.number().int().min(0).max(100_000_00),
      }),
    )
    .min(1)
    .max(60)
    .refine((r) => new Set(r.map((x) => x.role.toLowerCase())).size === r.length, 'Each role can appear only once'),
});
export type RateCard = z.infer<typeof rateCardSchema>;

export const rateCardSaveSchema = rateCardSchema.extend({
  /** The date the new rates start applying; earlier months keep the rates they had. */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Placeholders until the company sets its own. */
export const DEFAULT_RATE_CARD: RateCard = {
  roles: [
    { role: 'Project Manager', costRate: 900_00, billingRate: 1800_00 },
    { role: 'Analyst', costRate: 600_00, billingRate: 1300_00 },
    { role: 'Designer', costRate: 550_00, billingRate: 1200_00 },
    { role: 'Developer', costRate: 650_00, billingRate: 1400_00 },
    { role: 'QA Engineer', costRate: 450_00, billingRate: 1000_00 },
  ],
};

export const estimateLineSchema = z.object({
  module: z.string().trim().min(1).max(100),
  task: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(60),
  hours: z.number().min(0.25).max(10_000),
  note: z.string().trim().max(500).optional().or(z.literal('')),
});
export type EstimateLine = z.infer<typeof estimateLineSchema>;

export const estimateSaveSchema = z.object({
  note: z.string().trim().max(1000).optional().or(z.literal('')),
  lines: z.array(estimateLineSchema).max(500),
});

export const estimateCreateSchema = z.object({
  /** Start the new version from an earlier one instead of blank. */
  copyFrom: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

export const estimateDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(500).optional().or(z.literal('')),
});

/** How far over the estimate before a project is flagged. */
export const varianceSettingsSchema = z.object({
  warnPct: z.number().min(0).max(500),
  alertPct: z.number().min(0).max(500),
});
export type VarianceSettings = z.infer<typeof varianceSettingsSchema>;
export const DEFAULT_VARIANCE: VarianceSettings = { warnPct: 10, alertPct: 25 };

// ---------- Milestones and the timeline ----------
export const MILESTONE_STATUS = ['planned', 'in_progress', 'done'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUS)[number];
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const milestoneSchema = z
  .object({
    name: z.string().trim().min(2, 'Give the milestone a name').max(120),
    description: z.string().trim().max(1000).optional().or(z.literal('')),
    owner: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional().or(z.literal('')),
    plannedStart: day,
    plannedEnd: day,
    status: z.enum(MILESTONE_STATUS).default('planned'),
  })
  .refine((m) => m.plannedEnd >= m.plannedStart, { message: 'The end cannot be before the start', path: ['plannedEnd'] });

export const baselineSchema = z.object({
  /** Needed when a baseline already exists, so moving the goalposts leaves a reason behind. */
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});
