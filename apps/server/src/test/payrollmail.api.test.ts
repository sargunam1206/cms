import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import dayjs from 'dayjs';

const state = { configured: false, fail: new Set<string>() };
const outbox: { to: string; subject: string; attachments: { filename: string; content: Buffer }[] }[] = [];
vi.mock('../utils/mailer', () => ({
  mailConfigured: () => state.configured,
  sendMail: async (to: string, subject: string, _t: string, attachments: { filename: string; content: Buffer }[] = []) => {
    if (state.fail.has(to)) throw new Error('mailbox full');
    if (!state.configured) return false;
    outbox.push({ to, subject, attachments });
    return true;
  },
}));

import { AttendanceDay } from '../modules/attendance/model';
import { Employee } from '../modules/employees/model';
import { Payslip } from '../modules/payroll/model';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

describe('emailing payslips', () => {
  it('sends each employee their own PDF once, reports problems, and never double-sends', async () => {
    const admin = await createPerson(roles.Admin);
    await request(app).put('/api/payroll/workflow').set(admin.auth).send({ managementApproval: false }).expect(200);
    await request(app).post('/api/payroll/components').set(admin.auth).send({ code: 'BASIC', name: 'Basic', kind: 'earning', taxable: true, prorate: true, order: 1, active: true, fixedAmount: 0 });

    const people = [await createPerson(roles.Employee), await createPerson(roles.Employee), await createPerson(roles.Employee)];
    await Employee.updateOne({ _id: people[0].employee._id }, { email: 'one@example.com' });
    await Employee.updateOne({ _id: people[1].employee._id }, { email: 'two@example.com' });
    // people[2] has no employee email, so the login email is used (createPerson gives every user one)
    for (const p of people) {
      const days = [];
      for (let d = dayjs('2026-06-01'); d.month() === 5; d = d.add(1, 'day')) if (d.day() !== 0) days.push({ employee: p.employee._id, date: d.format('YYYY-MM-DD'), status: 'present', source: 'self' });
      await AttendanceDay.insertMany(days);
      await request(app).post(`/api/payroll/structures/${p.employee._id}`).set(admin.auth).send({ effectiveFrom: '2026-01-01', lines: [{ code: 'BASIC', fixedAmount: 20000 }] }).expect(201);
    }
    const run = (await request(app).post('/api/payroll/runs').set(admin.auth).send({ month: '2026-06' }).expect(201)).body;
    const url = `/api/payroll/runs/${run._id}/email-payslips`;

    await request(app).post(url).set(admin.auth).send({}).expect(409); // not approved yet
    await request(app).post(`/api/payroll/runs/${run._id}/compute`).set(admin.auth).expect(200);
    await request(app).post(`/api/payroll/runs/${run._id}/submit`).set(admin.auth).expect(200);

    await request(app).post(url).set(people[0].auth).send({}).expect(403);
    const unconfigured = await request(app).post(url).set(admin.auth).send({}).expect(409);
    expect(unconfigured.body.message).toMatch(/SMTP/);
    expect(await Payslip.countDocuments({ run: run._id, emailedAt: { $exists: true } })).toBe(0);

    state.configured = true;
    state.fail.add('two@example.com');
    const first = (await request(app).post(url).set(admin.auth).send({}).expect(200)).body;
    expect(first.sent).toBe(2);
    expect(first.failed).toHaveLength(1);
    expect(first.failed[0].reason).toMatch(/mailbox full/);
    expect(outbox.map((m) => m.to)).toContain('one@example.com');
    expect(outbox.every((m) => m.attachments[0].filename === 'payslip-2026-06.pdf' && m.attachments[0].content.subarray(0, 4).toString() === '%PDF')).toBe(true);
    expect(outbox.every((m) => m.subject.includes('June 2026'))).toBe(true);

    // Pressing again only retries the one that failed
    state.fail.clear();
    const before = outbox.length;
    const second = (await request(app).post(url).set(admin.auth).send({}).expect(200)).body;
    expect(second).toMatchObject({ sent: 1, alreadySent: 2 });
    expect(outbox).toHaveLength(before + 1);
    expect(outbox[outbox.length - 1].to).toBe('two@example.com');

    // An explicit resend goes to everyone
    const all = (await request(app).post(url).set(admin.auth).send({ resend: true }).expect(200)).body;
    expect(all.sent).toBe(3);
  });
});
