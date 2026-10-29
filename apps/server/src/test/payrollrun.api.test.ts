import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import dayjs from 'dayjs';
import { AttendanceDay } from '../modules/attendance/model';
import { Loan, Payslip } from '../modules/payroll/model';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

const MONTH = '2026-09';

/** Marks every Mon-Sat of September present for an employee. */
async function presentAllMonth(employee: unknown) {
  const days = [];
  for (let d = dayjs(`${MONTH}-01`); d.month() === 8; d = d.add(1, 'day')) {
    if (d.day() !== 0) days.push({ employee, date: d.format('YYYY-MM-DD'), status: 'present', source: 'self', workedMinutes: 540 });
  }
  await AttendanceDay.insertMany(days);
}

describe('payroll run workflow', () => {
  it('compute -> HR submit -> Management approve, with loans, one-time items, locks and payslip privacy', async () => {
    const hr = await createPerson(roles.HR);
    const mgmt = await createPerson(roles.Management);
    const a = await createPerson(roles.Employee);
    const b = await createPerson(roles.Employee); // no salary structure
    await presentAllMonth(a.employee._id);
    await presentAllMonth(b.employee._id);

    const comp = (code: string, order: number) => ({ code, name: code, kind: 'earning', taxable: true, prorate: true, order, active: true, fixedAmount: 0 });
    await request(app).post('/api/payroll/components').set(hr.auth).send(comp('BASIC', 1)).expect(201);
    await request(app).post('/api/payroll/components').set(hr.auth).send(comp('HRA', 2)).expect(201);
    await request(app)
      .post(`/api/payroll/structures/${a.employee._id}`)
      .set(hr.auth)
      .send({ effectiveFrom: '2026-01-01', lines: [{ code: 'BASIC', fixedAmount: 30000 }, { code: 'HRA', formula: 'BASIC*0.4' }] })
      .expect(201);
    const loan = (
      await request(app).post('/api/payroll/loans').set(hr.auth).send({ employee: a.employee._id, principal: 12000, emi: 4000, startMonth: MONTH }).expect(201)
    ).body;
    await request(app).post('/api/payroll/one-time').set(hr.auth).send({ employee: a.employee._id, month: MONTH, kind: 'earning', code: 'BONUS', name: 'Festival bonus', amount: 5000 }).expect(201);

    // creation rules
    await request(app).post('/api/payroll/runs').set(a.auth).send({ month: MONTH }).expect(403);
    await request(app).post('/api/payroll/runs').set(hr.auth).send({ month: '2099-01' }).expect(400); // not ended
    const run = (await request(app).post('/api/payroll/runs').set(hr.auth).send({ month: MONTH }).expect(201)).body;
    await request(app).post('/api/payroll/runs').set(hr.auth).send({ month: MONTH }).expect(409);
    expect((await request(app).get('/api/attendance/locks').set(hr.auth)).body.some((l: { month: string; locked: boolean }) => l.month === MONTH && l.locked)).toBe(true);

    // compute: A gets a payslip, B is listed as skipped
    await request(app).post(`/api/payroll/runs/${run._id}/submit`).set(hr.auth).expect(400); // nothing computed yet
    const computed = (await request(app).post(`/api/payroll/runs/${run._id}/compute`).set(hr.auth).expect(200)).body;
    expect(computed.totals.employees).toBe(1);
    expect(computed.skipped.map((s: { code: string }) => s.code)).toContain(b.employee.code);
    const slip = await Payslip.findOne({ run: run._id, employee: a.employee._id }).lean();
    expect(slip?.gross).toBe(3_000_000 + 1_200_000 + 500_000);
    expect(slip?.deductions.find((d) => d.code === 'LOAN')?.amount).toBe(400_000);
    expect(slip?.net).toBe((slip?.gross ?? 0) - (slip?.totalDeductions ?? 0));
    expect((await Loan.findById(loan._id).lean())?.balance).toBe(1_200_000); // untouched while draft

    // employees see nothing until approval
    expect((await request(app).get('/api/payroll/my/payslips').set(a.auth).expect(200)).body).toHaveLength(0);

    // HR submits; HR cannot approve; management approves
    await request(app).post(`/api/payroll/runs/${run._id}/submit`).set(hr.auth).expect(200);
    await request(app).post(`/api/payroll/runs/${run._id}/compute`).set(hr.auth).expect(409); // frozen once submitted
    await request(app).post(`/api/payroll/runs/${run._id}/approve`).set(hr.auth).expect(403);
    await request(app).post(`/api/payroll/runs/${run._id}/approve`).set(mgmt.auth).expect(200);

    expect((await Loan.findById(loan._id).lean())?.balance).toBe(800_000);
    // approved => attendance cannot be unlocked and adjustments are closed
    await request(app).post(`/api/attendance/locks/${MONTH}/unlock`).set(hr.auth).send({ reason: 'need to fix a day' }).expect(423);
    await request(app).post('/api/payroll/one-time').set(hr.auth).send({ employee: a.employee._id, month: MONTH, kind: 'earning', code: 'X', name: 'Late item', amount: 1 }).expect(409);

    // payslip privacy
    const mine = (await request(app).get('/api/payroll/my/payslips').set(a.auth).expect(200)).body;
    expect(mine).toHaveLength(1);
    expect(mine[0].inputs).toBeUndefined();
    expect((await request(app).get('/api/payroll/my/payslips').set(b.auth)).body).toHaveLength(0);
    await request(app).get(`/api/payroll/payslips/${mine[0]._id}`).set(a.auth).expect(403); // the generic reader needs payroll.view
    await request(app).get(`/api/payroll/payslips/${mine[0]._id}`).set(mgmt.auth).expect(200);

    // reopen restores the loan balance and returns to draft; recomputing reproduces the same slip
    await request(app).post(`/api/payroll/runs/${run._id}/reopen`).set(mgmt.auth).send({ reason: 'correction needed' }).expect(403);
    await request(app).post(`/api/payroll/runs/${run._id}/reopen`).set(hr.auth).send({ reason: 'correction needed' }).expect(200);
    expect((await Loan.findById(loan._id).lean())?.balance).toBe(1_200_000);
    const again = (await request(app).post(`/api/payroll/runs/${run._id}/compute`).set(hr.auth).expect(200)).body;
    expect(again.totals.net).toBe(computed.totals.net);
    expect((await request(app).get('/api/payroll/my/payslips').set(a.auth)).body).toHaveLength(0);
  });

  it('the reviewer cannot approve their own run; rejection returns it to draft; single-step approval can be configured', async () => {
    const admin = await createPerson(roles.Admin); // holds both permissions
    const mgmt = await createPerson(roles.Management);
    const emp = await createPerson(roles.Employee);
    await presentAllMonth(emp.employee._id);
    await request(app).post(`/api/payroll/structures/${emp.employee._id}`).set(admin.auth).send({ effectiveFrom: '2026-01-01', lines: [{ code: 'BASIC', fixedAmount: 20000 }] }).expect(201);

    // October run: needs a month that has ended, so use August with the same structure
    const run = (await request(app).post('/api/payroll/runs').set(admin.auth).send({ month: '2026-08' }).expect(201)).body;
    await AttendanceDay.insertMany(
      Array.from({ length: 31 }, (_, i) => ({ employee: emp.employee._id, date: `2026-08-${String(i + 1).padStart(2, '0')}`, status: 'present', source: 'self' })),
    );
    await request(app).post(`/api/payroll/runs/${run._id}/compute`).set(admin.auth).expect(200);
    await request(app).post(`/api/payroll/runs/${run._id}/submit`).set(admin.auth).expect(200);
    await request(app).post(`/api/payroll/runs/${run._id}/approve`).set(admin.auth).expect(403); // same person

    await request(app).post(`/api/payroll/runs/${run._id}/reject`).set(mgmt.auth).send({ comment: 'ok' }).expect(400); // comment too short
    const back = (await request(app).post(`/api/payroll/runs/${run._id}/reject`).set(mgmt.auth).send({ comment: 'Please recheck bonuses' }).expect(200)).body;
    expect(back.status).toBe('draft');

    // With management approval switched off, HR's submit is final
    await request(app).put('/api/payroll/workflow').set(admin.auth).send({ managementApproval: false }).expect(200);
    const done = (await request(app).post(`/api/payroll/runs/${run._id}/submit`).set(admin.auth).expect(200)).body;
    expect(done.status).toBe('approved');
    await request(app).delete(`/api/payroll/runs/${run._id}`).set(admin.auth).expect(409); // approved runs cannot be deleted
    await request(app).put('/api/payroll/workflow').set(admin.auth).send({ managementApproval: true }).expect(200);
  });
});
