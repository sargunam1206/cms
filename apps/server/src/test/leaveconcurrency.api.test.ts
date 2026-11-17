import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { LeaveBalance } from '../modules/leave/model';
import { app, connectTestDb, createPerson, dropTestDb, seedLeaveTypes, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
let types: Awaited<ReturnType<typeof seedLeaveTypes>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
  types = await seedLeaveTypes();
});
afterAll(dropTestDb);

/** A weekday a couple of weeks ahead, one per call, so requests never overlap. */
let offset = 14;
function nextWorkday() {
  for (;;) {
    const d = new Date(Date.now() + offset++ * 86400000);
    if (d.getUTCDay() !== 0) return d.toISOString().slice(0, 10);
  }
}

describe('two approvers deciding the same leave at the same moment', () => {
  it('only one decision takes effect and the balance is used once', async () => {
    const hr = await createPerson(roles.HR);
    const boss = await createPerson(roles.Manager);
    const emp = await createPerson(roles.Employee, { manager: boss.employee._id });
    const day = nextWorkday();
    const req = (await request(app).post('/api/leave/requests').set(emp.auth).send({ leaveType: String(types.CL._id), from: day, to: day, halfDay: false, reason: 'Family function' }).expect(201)).body;

    const decide = (who: typeof hr) => request(app).post(`/api/leave/requests/${req._id}/decision`).set(who.auth).send({ decision: 'approved', comment: 'ok' });
    const results = await Promise.all([decide(boss), decide(hr)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]); // one wins, the other is told it is already decided

    const bal = await LeaveBalance.findOne({ employee: emp.employee._id, leaveType: types.CL._id }).lean();
    expect(bal?.used).toBe(1); // not 2
  });

  it('many approvers at once still approve once', async () => {
    const hrs = [] as Awaited<ReturnType<typeof createPerson>>[];
    for (let i = 0; i < 4; i++) hrs.push(await createPerson(roles.HR));
    const emp = await createPerson(roles.Employee);
    const day = nextWorkday();
    const req = (await request(app).post('/api/leave/requests').set(emp.auth).send({ leaveType: String(types.CL._id), from: day, to: day, halfDay: false, reason: 'Medical visit' }).expect(201)).body;
    const results = await Promise.all(hrs.map((h) => request(app).post(`/api/leave/requests/${req._id}/decision`).set(h.auth).send({ decision: 'approved' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await LeaveBalance.findOne({ employee: emp.employee._id, leaveType: types.CL._id }).lean())?.used).toBe(1);
  });
});
