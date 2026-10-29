import mongoose from 'mongoose';
import request from 'supertest';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_NAMES, type RoleName } from '@cms/shared';
import { createApp } from '../app';
import { hashPassword } from '../modules/auth/service';
import { Employee } from '../modules/employees/model';
import { LeaveType } from '../modules/leave/model';
import { Role, User } from '../modules/users/model';

/** Each test file gets its own throwaway database on the local MongoDB. */
export async function connectTestDb() {
  const base = process.env.MONGO_TEST_URI ?? 'mongodb://127.0.0.1:27017';
  await mongoose.connect(`${base}/cms_test_${process.pid}_${Date.now()}`);
}

export async function dropTestDb() {
  // Let pending index builds finish first; otherwise they re-create the database right after the drop
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export const app = createApp();

export async function seedRoles() {
  const roles = {} as Record<RoleName, mongoose.Types.ObjectId>;
  for (const name of ROLE_NAMES) {
    roles[name] = (await Role.create({ name, permissions: DEFAULT_ROLE_PERMISSIONS[name], system: true }))._id;
  }
  return roles;
}

export async function seedLeaveTypes() {
  return {
    CL: await LeaveType.create({ code: 'CL', name: 'Casual', paid: true, annualQuota: 2, accrual: 'yearly' }),
    LOP: await LeaveType.create({ code: 'LOP', name: 'Loss of Pay', paid: false, annualQuota: 0 }),
  };
}

let seq = 0;
export async function createPerson(roleId: mongoose.Types.ObjectId, opts: { manager?: mongoose.Types.ObjectId; doj?: string } = {}) {
  seq++;
  const emp = await Employee.create({ code: `T${seq}`, name: `Test ${seq}`, dateOfJoining: opts.doj ?? '2024-01-01', manager: opts.manager ?? null });
  const email = `user${seq}@test.local`;
  await User.create({ email, passwordHash: await hashPassword('Passw0rd!'), role: roleId, employee: emp._id });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return { employee: emp, token: res.body.accessToken as string, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}
