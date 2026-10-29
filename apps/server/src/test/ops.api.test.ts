import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';

const sent: { to: string; text: string }[] = [];
vi.mock('../utils/mailer', () => ({ sendMail: async (to: string, _s: string, text: string) => void sent.push({ to, text }) }));

import { Employee } from '../modules/employees/model';
import { backupDatabase, restoreDatabase } from '../utils/backup';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

describe('password reset', () => {
  it('emails a single-use link; unknown emails look identical; old sessions die', async () => {
    const p = await createPerson(roles.Employee);
    const email = (await mongoose.model('User').findOne({ employee: p.employee._id }).lean<{ email: string }>())!.email;

    await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@company.local' }).expect(204);
    expect(sent).toHaveLength(0);

    await request(app).post('/api/auth/forgot-password').send({ email }).expect(204);
    expect(sent).toHaveLength(1);
    const token = new URL(sent[0].text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

    await request(app).post('/api/auth/reset-password').send({ token: 'x'.repeat(40), newPassword: 'NewPassw0rd!' }).expect(400);
    await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'short' }).expect(400);
    await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'NewPassw0rd!' }).expect(204);
    await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'Another1234' }).expect(400); // single use

    await request(app).post('/api/auth/login').send({ email, password: 'NewPassw0rd!' }).expect(200);
    await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!' }).expect(401);
  });
});

describe('paged lists', () => {
  it('users, leave requests and register report total/page/limit', async () => {
    const admin = await createPerson(roles.Admin);
    for (let i = 0; i < 3; i++) await createPerson(roles.Employee);
    const users = await request(app).get('/api/users?limit=2').set(admin.auth).expect(200);
    expect(users.body.items).toHaveLength(2);
    expect(users.body.total).toBeGreaterThan(2);
    const p2 = await request(app).get('/api/users?limit=2&page=2').set(admin.auth);
    expect(p2.body.items[0]._id).not.toBe(users.body.items[0]._id);

    const reg = await request(app).get('/api/attendance/register?month=2026-10&limit=2').set(admin.auth).expect(200);
    expect(reg.body.rows).toHaveLength(2);
    expect(reg.body.total).toBeGreaterThan(2);
    const lv = await request(app).get('/api/leave/requests?limit=5').set(admin.auth).expect(200);
    expect(lv.body).toMatchObject({ items: [], total: 0, page: 1, limit: 5 });
  });
});

describe('backup & restore', () => {
  it('round-trips ObjectIds and dates, and prunes old files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-bk-'));
    const emp = await Employee.create({ code: 'BK1', name: 'Backup Person', dateOfJoining: '2024-01-01' });
    const r1 = await backupDatabase(dir, 1);
    await new Promise((r) => setTimeout(r, 1100)); // file names have 1s resolution
    const r2 = await backupDatabase(dir, 1);
    expect(r2.pruned).toBe(1);
    expect(await fs.readdir(dir)).toHaveLength(1);
    expect(r1.collections).toBeGreaterThan(3);

    await Employee.deleteMany({});
    await restoreDatabase(r2.file);
    const back = await Employee.findById(emp._id).lean();
    expect(back?.name).toBe('Backup Person');
    expect(back?.createdAt).toBeInstanceOf(Date);
    await fs.rm(dir, { recursive: true });
  });
});
