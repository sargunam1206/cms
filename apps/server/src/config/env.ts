import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().default('mongodb://127.0.0.1:27017/cms'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(8).default('dev-access-secret'),
  JWT_REFRESH_SECRET: z.string().min(8).default('dev-refresh-secret'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  TZ_NAME: z.string().default('Asia/Kolkata'),
  // Outgoing mail (password reset). Without SMTP_HOST the reset link is written to the server log instead.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('CMS <no-reply@company.local>'),
  COMPANY_NAME: z.string().default('Company'),
  // Nightly JSON backup of the database; unset to disable
  BACKUP_DIR: z.string().optional(),
  BACKUP_KEEP: z.coerce.number().default(14),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@company.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET.startsWith('dev-')) {
  throw new Error('Set JWT secrets in production');
}
