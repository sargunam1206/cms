import { z } from 'zod';

/** Statutory configuration. Every rate and limit lives here (and in the DB), never in code. Defaults are PLACEHOLDERS to be verified with the CA. */
const slab = z.object({ upTo: z.number().nullable(), rate: z.number().min(0).max(1) }); // upTo in rupees (annual); null = no upper limit

export const statutorySchema = z.object({
  pf: z.object({
    enabled: z.boolean(),
    employeeRate: z.number().min(0).max(1),
    employerRate: z.number().min(0).max(1),
    wageCeiling: z.number().min(0), // rupees per month
    basisComponents: z.array(z.string()), // earning codes that form PF wages
    capAtCeiling: z.boolean(), // false = contribute on full wages (voluntary higher PF)
  }),
  esi: z.object({
    enabled: z.boolean(),
    employeeRate: z.number().min(0).max(1),
    employerRate: z.number().min(0).max(1),
    grossThreshold: z.number().min(0), // rupees per month; above this ESI does not apply
  }),
  pt: z.object({
    enabled: z.boolean(),
    deductionMonths: z.array(z.number().int().min(1).max(12)), // months in which half-yearly PT is collected
    slabs: z.array(z.object({ upTo: z.number().nullable(), amount: z.number().min(0) })), // half-yearly gross (rupees) -> PT (rupees)
  }),
  tds: z.object({
    enabled: z.boolean(),
    cessRate: z.number().min(0).max(1),
    newRegime: z.object({ standardDeduction: z.number(), rebateLimit: z.number(), rebateMax: z.number(), slabs: z.array(slab) }),
    oldRegime: z.object({ standardDeduction: z.number(), rebateLimit: z.number(), rebateMax: z.number(), slabs: z.array(slab) }),
  }),
});
export type StatutorySettings = z.infer<typeof statutorySchema>;

export const DEFAULT_STATUTORY: StatutorySettings = {
  pf: { enabled: true, employeeRate: 0.12, employerRate: 0.12, wageCeiling: 15000, basisComponents: ['BASIC'], capAtCeiling: true },
  esi: { enabled: true, employeeRate: 0.0075, employerRate: 0.0325, grossThreshold: 21000 },
  pt: {
    enabled: true,
    deductionMonths: [9, 3], // September and March
    slabs: [
      { upTo: 21000, amount: 0 },
      { upTo: 30000, amount: 135 },
      { upTo: 45000, amount: 315 },
      { upTo: 60000, amount: 690 },
      { upTo: 75000, amount: 1025 },
      { upTo: null, amount: 1250 },
    ],
  },
  tds: {
    enabled: true,
    cessRate: 0.04,
    newRegime: {
      standardDeduction: 75000,
      rebateLimit: 1200000,
      rebateMax: 60000,
      slabs: [
        { upTo: 400000, rate: 0 },
        { upTo: 800000, rate: 0.05 },
        { upTo: 1200000, rate: 0.1 },
        { upTo: 1600000, rate: 0.15 },
        { upTo: 2000000, rate: 0.2 },
        { upTo: 2400000, rate: 0.25 },
        { upTo: null, rate: 0.3 },
      ],
    },
    oldRegime: {
      standardDeduction: 50000,
      rebateLimit: 500000,
      rebateMax: 12500,
      slabs: [
        { upTo: 250000, rate: 0 },
        { upTo: 500000, rate: 0.05 },
        { upTo: 1000000, rate: 0.2 },
        { upTo: null, rate: 0.3 },
      ],
    },
  },
};

// ---------- Salary components ----------
export const COMPONENT_KINDS = ['earning', 'deduction'] as const;
export const COMPONENT_CODE = /^[A-Z][A-Z0-9_]{0,19}$/;

export const salaryComponentSchema = z
  .object({
    code: z.string().regex(COMPONENT_CODE, 'Use capitals, digits and _ (e.g. BASIC, HRA)'),
    name: z.string().min(1).max(60),
    kind: z.enum(COMPONENT_KINDS),
    // Either a fixed monthly amount (rupees) or a formula over other component codes, e.g. "BASIC*0.4"
    fixedAmount: z.number().min(0).optional(),
    formula: z.string().max(200).optional(),
    taxable: z.boolean(),
    prorate: z.boolean(), // scaled by paid days / total days (earnings only)
    order: z.number().int().min(0).max(999),
    active: z.boolean(),
  })
  .refine((c) => (c.fixedAmount === undefined) !== (c.formula === undefined || c.formula === ''), {
    message: 'Provide either a fixed amount or a formula',
  });
export type SalaryComponentInput = z.infer<typeof salaryComponentSchema>;

// ---------- Templates and employee salary structures ----------
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** One component's value inside a template or a structure. */
export const structureLineSchema = z
  .object({
    code: z.string().regex(COMPONENT_CODE),
    fixedAmount: z.number().min(0).max(100_000_000).optional(),
    formula: z.string().max(200).optional(),
  })
  .refine((l) => (l.fixedAmount === undefined) !== (l.formula === undefined || l.formula === ''), {
    message: 'Each line needs either a fixed amount or a formula',
  });

export const salaryTemplateSchema = z.object({
  name: z.string().min(2).max(60),
  lines: z.array(structureLineSchema).min(1).max(40),
});

export const salaryStructureSchema = z.object({
  effectiveFrom: dateOnly,
  template: z.string().regex(/^[a-f\d]{24}$/i).optional(), // template this was started from (informational)
  lines: z.array(structureLineSchema).min(1).max(40),
});
export type SalaryStructureInput = z.infer<typeof salaryStructureSchema>;
