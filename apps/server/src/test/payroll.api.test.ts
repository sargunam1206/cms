import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AuditLog } from '../modules/audit/model';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

describe('payroll setup', () => {
  it('only payroll roles can see or change anything; reads are audited', async () => {
    const emp = await createPerson(roles.Employee);
    const mgr = await createPerson(roles.Manager);
    const hr = await createPerson(roles.HR);
    const mgmt = await createPerson(roles.Management);

    for (const who of [emp, mgr]) {
      await request(app).get('/api/payroll/components').set(who.auth).expect(403);
      await request(app).get(`/api/payroll/structures/${emp.employee._id}`).set(who.auth).expect(403);
    }
    await request(app).get('/api/payroll/components').set(hr.auth).expect(200);
    await request(app).get('/api/payroll/components').set(mgmt.auth).expect(200);
    // Management may view but not change
    await request(app).post('/api/payroll/components').set(mgmt.auth).send({ code: 'BASIC', name: 'Basic', kind: 'earning', fixedAmount: 1, taxable: true, prorate: true, order: 1, active: true }).expect(403);

    const before = await AuditLog.countDocuments({ action: 'payroll.read' });
    await request(app).get(`/api/payroll/structures/${emp.employee._id}`).set(mgmt.auth).expect(200);
    expect(await AuditLog.countDocuments({ action: 'payroll.read' })).toBe(before + 1);
  });

  it('components, template, structure and a live preview', async () => {
    const hr = await createPerson(roles.HR);
    const emp = await createPerson(roles.Employee);
    const comp = (code: string, order: number, extra = {}) => ({ code, name: code, kind: 'earning', taxable: true, prorate: true, order, active: true, ...extra });

    await request(app).post('/api/payroll/components').set(hr.auth).send({ ...comp('BASIC', 1), fixedAmount: 0 }).expect(201);
    await request(app).post('/api/payroll/components').set(hr.auth).send({ ...comp('HRA', 2), fixedAmount: 0 }).expect(201);
    await request(app).post('/api/payroll/components').set(hr.auth).send({ ...comp('BASIC', 1), fixedAmount: 0 }).expect(409);
    await request(app).post('/api/payroll/components').set(hr.auth).send({ ...comp('bad code', 3), fixedAmount: 0 }).expect(400);
    await request(app).post('/api/payroll/components').set(hr.auth).send(comp('NOVAL', 3)).expect(400); // needs fixed amount or formula

    // Lines are validated: unknown code, cycle, unsafe formula
    const tpl = (lines: unknown[]) => request(app).post('/api/payroll/templates').set(hr.auth).send({ name: `T${Math.random()}`, lines });
    await tpl([{ code: 'NOPE', fixedAmount: 1 }]).expect(400);
    await tpl([{ code: 'BASIC', formula: 'HRA' }, { code: 'HRA', formula: 'BASIC' }]).expect(400);
    await tpl([{ code: 'BASIC', formula: 'import("fs")' }]).expect(400);
    const good = await tpl([{ code: 'BASIC', fixedAmount: 30000 }, { code: 'HRA', formula: 'BASIC*0.4' }]).expect(201);

    const eid = emp.employee._id;
    await request(app).get(`/api/payroll/preview/${eid}?month=2026-09`).set(hr.auth).expect(400); // no structure yet
    await request(app)
      .post(`/api/payroll/structures/${eid}`)
      .set(hr.auth)
      .send({ effectiveFrom: '2026-08-01', template: good.body._id, lines: good.body.lines })
      .expect(201);
    // A later revision replaces the earlier one from its effective date onward
    await request(app).post(`/api/payroll/structures/${eid}`).set(hr.auth).send({ effectiveFrom: '2026-10-01', lines: [{ code: 'BASIC', fixedAmount: 40000 }] }).expect(201);

    const sep = (await request(app).get(`/api/payroll/preview/${eid}?month=2026-09`).set(hr.auth).expect(200)).body;
    const oct = (await request(app).get(`/api/payroll/preview/${eid}?month=2026-10`).set(hr.auth).expect(200)).body;
    const earned = (r: { earnings: { code: string; amount: number }[] }, c: string) => r.earnings.find((e) => e.code === c)?.amount ?? 0;
    // Earnings are prorated by the attendance that actually exists, in paise
    expect(earned(sep, 'BASIC')).toBe(Math.round((3_000_000 * sep.paidDays) / sep.totalDays));
    expect(earned(sep, 'HRA')).toBe(Math.round((1_200_000 * sep.paidDays) / sep.totalDays));
    expect(earned(oct, 'HRA')).toBe(0); // October's revision has no HRA line
    expect(earned(oct, 'BASIC')).toBe(Math.round((4_000_000 * oct.paidDays) / oct.totalDays));
    expect(sep.net).toBe(sep.gross - sep.totalDeductions);

    const hist = await request(app).get(`/api/payroll/structures/${eid}`).set(hr.auth).expect(200);
    expect(hist.body.map((s: { effectiveFrom: string }) => s.effectiveFrom)).toEqual(['2026-10-01', '2026-08-01']);
  });

  it('statutory settings default to the placeholders and can be changed with an effective date', async () => {
    const hr = await createPerson(roles.HR);
    const cur = (await request(app).get('/api/payroll/statutory').set(hr.auth).expect(200)).body;
    expect(cur.pf.wageCeiling).toBe(15000);
    await request(app).put('/api/payroll/statutory').set(hr.auth).send({ value: { ...cur, pf: { ...cur.pf, wageCeiling: 21000 } } }).expect(200);
    expect((await request(app).get('/api/payroll/statutory').set(hr.auth)).body.pf.wageCeiling).toBe(21000);
    await request(app).put('/api/payroll/statutory').set(hr.auth).send({ value: { ...cur, pf: { ...cur.pf, employeeRate: 5 } } }).expect(400); // rate must be 0-1
  });
});
