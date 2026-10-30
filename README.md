# Company Management System

MERN monorepo (React + Vite + TS + Tailwind/shadcn · Express + TS · MongoDB) built in phases from
`Company_Management_System_Approach_Plan.pdf`.

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: auth, RBAC, audit log, settings | ✅ |
| 1 | Users, roles, employee master, attendance, leave | ✅ |
| 2 | Payroll: salary structure, payroll run, payslips (PDF), bank file, PF/ESI/PT/TDS reports, full & final | ✅ done (statutory rates need CA sign-off) |
| 3 | Projects, tasks, time logs, notifications | |
| 4 | Estimation, timelines, estimated vs actual | |
| 5 | Enquiry/CRM, innovation hub, dashboards | |

## Run locally

Prerequisites: Node 20+, and MongoDB on `127.0.0.1:27017` (either a local service or `docker compose up -d`).

```bash
npm install
cp apps/server/.env.example apps/server/.env   # then change the JWT secrets
npm run seed          # roles, default settings, leave types, admin login
npm run seed:demo     # optional: sample HR / manager / employees
npm run dev           # API on :4000, web on http://localhost:5173
npm test              # unit + API tests (uses a throwaway DB on the local MongoDB)
```

Logins: `admin@company.local` / `Admin@12345`. With demo data, `hr@`, `manager@`, `divya@`, `karthik@` and `director@company.local` all use `Passw0rd!`.

## Layout

```
packages/shared   zod schemas, enums, permission keys (used by both client and server)
apps/server       src/modules/<module>/{model,service,routes,rules}.ts, jobs/, seed/, test/
apps/client       src/features/<module>/ pages, src/components/ui (shadcn-style)
```

## Rules worth knowing

- **Server time only.** Check-in and check-out ignore the request body. "Now" comes from `utils/time.ts`, in office timezone `TZ_NAME`.
- **Everything is configurable.** Work calendar (weekly offs, alternate Saturdays, shift, grace, late-mark limit, minimum hours), holidays, and leave types live in the DB. The work calendar is effective-dated.
- **Month summary** (`attendance/rules.ts → summarizeMonth`) gives paid days = calendar days − LOP. LOP = absent + unpaid leave + late penalty (every N late marks = ½ day). Days before joining or after exit are not paid. Phase 2 payroll consumes `attendanceSummary()`.
- **Locks.** A locked month rejects punches, regularizations, and leave changes with HTTP 423. Only `attendance.lock` holders can unlock, a reason is required, and every unlock is audit-logged.
- **Missed check-out.** A nightly job at 00:15 IST marks it absent until the employee regularizes it.

## Operations

**Backups.** With `BACKUP_DIR` set in `apps/server/.env`, the server writes a gzipped JSON backup of every collection at 01:00 IST daily and keeps the newest `BACKUP_KEEP` files. Run one on demand with `npm run backup -w @cms/server`. Restore (this REPLACES the data in the database named by `MONGO_URI`):

    cd apps/server
    npx tsx --env-file=.env src/scripts/restore.ts backups/cms-YYYYMMDD-HHmmss.json.gz --yes

Copy the `backups` folder off the machine regularly; a backup on the same disk does not survive a disk failure.

**Password reset.** "Forgot password?" on the login page emails a 30-minute single-use link. Set `SMTP_*` in `.env` to send real mail; without it the link is printed in the server log.

**Leave carry-forward.** Runs automatically at 00:30 IST on 1 January (last year's unused leave, capped per leave type). It can also be run manually from Leave Management and is safe to repeat.

**Before go-live.** Replace the JWT secrets, enable MongoDB authentication (`security.authorization` in mongod.cfg, then put the credentials in `MONGO_URI`), and set `NODE_ENV=production`.

**Known accepted audit findings.** `zod` (large-collection DoS; request bodies are capped at 1 MB and array fields are length-limited), `react-router` (SSR/open-redirect issues; the app has no SSR and no user-supplied redirect targets) and `uuid` via `node-cron` (a bounds check on APIs the scheduler does not use). Fixing them needs major-version upgrades; revisit when upgrading.

## Payroll notes

- Setup order: Payroll Setup → components, a template, statutory rules → set each employee's salary (Employees → Salary) → Payroll Runs → New run for a finished month → Calculate → Submit → (Management) Approve → download the bank file and reports.
- Amounts are stored as integer paise. All rates and slabs live in the database (Payroll Setup → Statutory) and are **placeholders until your CA verifies them**.
- Set `COMPANY_NAME` in `apps/server/.env` to print your company name on payslip PDFs.
- Full & final: set the employee's exit date first; settlement covers exit-month pay, encashable leave, optional gratuity estimate and loan recovery. Tax on the settlement is not calculated.

**Emailing payslips.** On an approved run, HR can click **Email payslips** to send each employee their own PDF (employee email, falling back to their login email). Anyone already emailed is skipped, so a second click only retries failures. This needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `apps/server/.env` (restart the server after editing); without them the button explains that email is not set up.
