/**
 * Idempotent seed: roles, default settings, leave types and the admin login.
 * `npm run seed:demo` also creates sample employees with logins (password: Passw0rd!).
 */
import { DEFAULT_ENQUIRY_OPTIONS, DEFAULT_RATE_CARD, DEFAULT_ROLE_PERMISSIONS, DEFAULT_WORK_CALENDAR, PHASE3_PERMISSIONS, PHASE4_PERMISSIONS, PHASE5_PERMISSIONS, ROLE_NAMES } from '@cms/shared';
import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { hashPassword } from '../modules/auth/service';
import { Employee } from '../modules/employees/model';
import { LeaveType } from '../modules/leave/model';
import { SalaryComponent, SalaryTemplate } from '../modules/payroll/model';
import { Setting } from '../modules/settings/model';
import { SETTING_KEYS } from '../modules/settings/service';
import { Role, User } from '../modules/users/model';

const LEAVE_TYPES = [
  { code: 'CL', name: 'Casual Leave', paid: true, annualQuota: 12, accrual: 'yearly', carryForwardMax: 0, encashable: false },
  { code: 'SL', name: 'Sick Leave', paid: true, annualQuota: 12, accrual: 'yearly', carryForwardMax: 0, encashable: false },
  { code: 'EL', name: 'Earned Leave', paid: true, annualQuota: 15, accrual: 'monthly', carryForwardMax: 30, encashable: true },
  { code: 'LOP', name: 'Loss of Pay', paid: false, annualQuota: 0, accrual: 'yearly', carryForwardMax: 0, encashable: false },
];

const PAY_COMPONENTS = [
  { code: 'BASIC', name: 'Basic Salary', kind: 'earning', taxable: true, prorate: true, order: 10 },
  { code: 'HRA', name: 'House Rent Allowance', kind: 'earning', taxable: true, prorate: true, order: 20 },
  { code: 'SPECIAL', name: 'Special Allowance', kind: 'earning', taxable: true, prorate: true, order: 30 },
  { code: 'CONV', name: 'Conveyance Allowance', kind: 'earning', taxable: true, prorate: true, order: 40 },
] as const;

const DEMO = [
  { code: 'HR001', name: 'Priya HR', role: 'HR', email: 'hr@company.local', department: 'HR', designation: 'HR Executive' },
  { code: 'MG001', name: 'Arun Manager', role: 'Manager', email: 'manager@company.local', department: 'Engineering', designation: 'Tech Lead' },
  { code: 'EM001', name: 'Divya Dev', role: 'Employee', email: 'divya@company.local', department: 'Engineering', designation: 'Developer', reportsTo: 'MG001' },
  { code: 'EM002', name: 'Karthik Dev', role: 'Employee', email: 'karthik@company.local', department: 'Engineering', designation: 'Developer', reportsTo: 'MG001' },
  { code: 'MD001', name: 'Meena Director', role: 'Management', email: 'director@company.local', department: 'Management', designation: 'Director' },
];

async function upsertLogin(email: string, password: string, roleId: unknown, employeeId: unknown) {
  if (await User.exists({ email })) return;
  await User.create({ email, passwordHash: await hashPassword(password), role: roleId, employee: employeeId });
  logger.info(`Created login ${email}`);
}

async function main() {
  await connectDb(env.MONGO_URI);

  const roles: Record<string, unknown> = {};
  for (const name of ROLE_NAMES) {
    // Only Admin's permissions are re-synced; other roles keep any edits made in the UI
    const existing = await Role.findOne({ name });
    if (!existing) {
      roles[name] = (await Role.create({ name, permissions: DEFAULT_ROLE_PERMISSIONS[name], system: true }))._id;
    } else {
      if (name === 'Admin') await Role.updateOne({ _id: existing._id }, { permissions: DEFAULT_ROLE_PERMISSIONS.Admin });
      roles[name] = existing._id;
    }
  }

  // One-time: give existing roles the Phase 3 permissions they get by default. After this, roles are theirs to edit.
  if (!(await Setting.exists({ key: 'migration.phase3Permissions' }))) {
    for (const name of ROLE_NAMES) {
      const add = DEFAULT_ROLE_PERMISSIONS[name].filter((p) => PHASE3_PERMISSIONS.includes(p));
      if (add.length) await Role.updateOne({ name }, { $addToSet: { permissions: { $each: add } } });
    }
    await Setting.create({ key: 'migration.phase3Permissions', value: { done: true }, effectiveFrom: '1970-01-01' });
    logger.info('Added Phase 3 permissions to existing roles');
  }

  if (!(await Setting.exists({ key: 'migration.phase4Permissions' }))) {
    for (const name of ROLE_NAMES) {
      const add = DEFAULT_ROLE_PERMISSIONS[name].filter((p) => PHASE4_PERMISSIONS.includes(p));
      if (add.length) await Role.updateOne({ name }, { $addToSet: { permissions: { $each: add } } });
    }
    await Setting.create({ key: 'migration.phase4Permissions', value: { done: true }, effectiveFrom: '1970-01-01' });
    logger.info('Added Phase 4 permissions to existing roles');
  }

  if (!(await Setting.exists({ key: 'migration.phase5Permissions' }))) {
    for (const name of ROLE_NAMES) {
      const add = DEFAULT_ROLE_PERMISSIONS[name].filter((p) => PHASE5_PERMISSIONS.includes(p));
      if (add.length) await Role.updateOne({ name }, { $addToSet: { permissions: { $each: add } } });
    }
    await Setting.create({ key: 'migration.phase5Permissions', value: { done: true }, effectiveFrom: '1970-01-01' });
    logger.info('Added Phase 5 permissions to existing roles');
  }
  await Setting.updateOne({ key: 'enquiryOptions', effectiveFrom: '1970-01-01' }, { $setOnInsert: { value: DEFAULT_ENQUIRY_OPTIONS } }, { upsert: true });

  // A starting rate card (placeholders) so estimates can be written straight away; the company edits it in Settings
  await Setting.updateOne({ key: 'rateCard', effectiveFrom: '1970-01-01' }, { $setOnInsert: { value: DEFAULT_RATE_CARD } }, { upsert: true });

  await Setting.updateOne(
    { key: SETTING_KEYS.WORK_CALENDAR, effectiveFrom: '1970-01-01' },
    { $setOnInsert: { value: DEFAULT_WORK_CALENDAR } },
    { upsert: true },
  );

  for (const lt of LEAVE_TYPES) {
    await LeaveType.updateOne({ code: lt.code }, { $setOnInsert: lt }, { upsert: true });
  }

  for (const c of PAY_COMPONENTS) await SalaryComponent.updateOne({ code: c.code }, { $setOnInsert: { ...c, active: true } }, { upsert: true });
  await SalaryTemplate.updateOne(
    { name: 'Standard (Basic + HRA 40% + Special)' },
    { $setOnInsert: { lines: [{ code: 'BASIC', fixedAmount: 20000 }, { code: 'HRA', formula: 'BASIC*0.4' }, { code: 'SPECIAL', fixedAmount: 5000 }] } },
    { upsert: true },
  );

  // The admin login lives in the database (password stored hashed). SEED_ADMIN_* are only read to create the very
  // first admin on a fresh database, and can be removed from .env afterwards.
  if (await User.exists({ role: roles.Admin })) {
    logger.info('An admin login already exists; SEED_ADMIN_* are not needed');
  } else if (!env.SEED_ADMIN_PASSWORD) {
    logger.warn('No admin login exists yet. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env once, run the seed, then remove them');
  } else {
    const email = env.SEED_ADMIN_EMAIL ?? 'admin@company.local';
    const adminEmp = await Employee.findOneAndUpdate(
      { code: 'ADM001' },
      { $setOnInsert: { code: 'ADM001', name: 'System Admin', email, dateOfJoining: '2024-01-01', department: 'Admin' } },
      { upsert: true, new: true },
    );
    await upsertLogin(email, env.SEED_ADMIN_PASSWORD, roles.Admin, adminEmp._id);
  }

  if (process.argv.includes('--demo')) {
    const ids: Record<string, unknown> = {};
    for (const d of DEMO) {
      const emp = await Employee.findOneAndUpdate(
        { code: d.code },
        {
          $setOnInsert: {
            code: d.code,
            name: d.name,
            email: d.email,
            department: d.department,
            designation: d.designation,
            dateOfJoining: '2024-04-01',
            manager: d.reportsTo ? ids[d.reportsTo] : null,
          },
        },
        { upsert: true, new: true },
      );
      ids[d.code] = emp._id;
      await upsertLogin(d.email, 'Passw0rd!', roles[d.role], emp._id);
    }
  }

  logger.info('Seed complete');
  await disconnectDb();
}

main().catch(async (err) => {
  logger.error(err);
  await disconnectDb();
  process.exit(1);
});
