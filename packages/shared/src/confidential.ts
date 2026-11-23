import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/** A folder in the confidential area. Editors may upload and change documents in it; everyone with access may read. */
export const confidentialFolderSchema = z.object({
  name: z.string().trim().min(2, 'Name the folder').max(80),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  editors: z.array(id).max(50).default([]), // employee ids
});

export const confidentialDocSchema = z.object({
  title: z.string().trim().min(2, 'Give the document a title').max(150),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  /** Renewal / expiry / review date, e.g. a contract end or licence expiry. */
  expiresOn: day.nullable().optional().or(z.literal('')),
  /** How many days before expiresOn the reminder starts. */
  remindDays: z.coerce.number().int().min(1).max(365).default(30),
});
