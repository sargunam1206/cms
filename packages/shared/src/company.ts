import { z } from 'zod';

const blank = z.literal('');
const opt = (schema: z.ZodString) => schema.or(blank).optional();
const upper = (max: number, re: RegExp, msg: string) => z.string().trim().toUpperCase().max(max).regex(re, msg);

/** Details printed in the header of payslips and other documents. Everything except the name is optional. */
export const companySchema = z.object({
  name: z.string().trim().min(2, 'Company name is required').max(120),
  address: opt(z.string().trim().max(300)), // up to a few lines; newlines are kept
  phone: opt(z.string().trim().max(30)),
  email: opt(z.string().trim().email('Enter a valid email').max(120)),
  website: opt(z.string().trim().max(120)),
  gstin: opt(upper(15, /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN should look like 33ABCDE1234F1Z5')),
  pan: opt(upper(10, /^[A-Z]{5}\d{4}[A-Z]$/, 'PAN should look like ABCDE1234F')),
  tan: opt(upper(10, /^[A-Z]{4}\d{5}[A-Z]$/, 'TAN should look like CHEA12345B')),
  pfRegNo: opt(z.string().trim().max(30)),
  esiRegNo: opt(z.string().trim().max(30)),
  signatoryName: opt(z.string().trim().max(80)),
  signatoryTitle: opt(z.string().trim().max(80)),
});
export type CompanyProfile = z.infer<typeof companySchema>;
export const COMPANY_IMAGES = ['logo', 'signature'] as const;
export type CompanyImage = (typeof COMPANY_IMAGES)[number];
