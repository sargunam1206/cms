import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_RATE_CARD } from '@cms/shared';
import { Setting } from '../modules/settings/model';
import { Notification } from '../modules/notifications/model';
import { Employee } from '../modules/employees/model';
import { TimeLog } from '../modules/timesheets/model';
import { User } from '../modules/users/model';
import { Project } from '../modules/projects/model';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
  await Setting.create({ key: 'rateCard', value: DEFAULT_RATE_CARD, effectiveFrom: '1970-01-01' });
});
afterAll(dropTestDb);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);
const LINES = [
  { module: 'Auth', task: 'Login screen', role: 'Developer', hours: 10 },
  { module: 'Auth', task: 'Login tests', role: 'qa engineer', hours: 4 },
];

async function world() {
  const mgmt = await createPerson(roles.Management);
  const mgmt2 = await createPerson(roles.Management);
  const hr = await createPerson(roles.HR);
  const lead = await createPerson(roles.Manager);
  const otherLead = await createPerson(roles.Manager);
  const dev = await createPerson(roles.Employee);
  const outsider = await createPerson(roles.Employee);
  const code = `ES-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: 'Estimated project', manager: id(lead), members: [id(dev)], status: 'active' }).expect(201)).body;
  return { mgmt, mgmt2, hr, lead, otherLead, dev, outsider, project };
}
const create = (w: Awaited<ReturnType<typeof world>>, who: Person = w.lead, body: object = {}) => request(app).post(`/api/estimates/project/${w.project._id}`).set(who.auth).send(body);
const save = (eid: string, who: Person, lines: object[] = LINES, note?: string) => request(app).put(`/api/estimates/${eid}`).set(who.auth).send({ lines, note });

describe('rate card', () => {
  it('is readable by people who may see cost, editable only by approvers', async () => {
    const w = await world();
    expect((await request(app).get('/api/estimates/rate-card').set(w.mgmt.auth).expect(200)).body.roles.length).toBe(DEFAULT_RATE_CARD.roles.length);
    await request(app).get('/api/estimates/rate-card').set(w.lead.auth).expect(403);
    await request(app).get('/api/estimates/rate-card').set(w.dev.auth).expect(403);
    const body = { effectiveFrom: '2026-01-01', roles: [{ role: 'Developer', costRate: 70000, billingRate: 150000 }] };
    await request(app).put('/api/estimates/rate-card').set(w.hr.auth).send(body).expect(403);
    await request(app).put('/api/estimates/rate-card').set(w.mgmt.auth).send({ ...body, roles: [body.roles[0], { ...body.roles[0], role: 'developer' }] }).expect(400);
    // restore so the other tests keep the defaults
    await Setting.deleteMany({ key: 'rateCard', effectiveFrom: '2026-01-01' });
  });

  it('role names are available to pickers without any rates', async () => {
    const w = await world();
    const r = await request(app).get('/api/estimates/roles').set(w.lead.auth).expect(200);
    expect(r.body).toContain('Developer');
    expect(JSON.stringify(r.body)).not.toMatch(/Rate/);
  });
});

describe('writing an estimate', () => {
  it('only the project manager (or Management) can start one; rates are frozen into lines and totalled', async () => {
    const w = await world();
    await create(w, w.otherLead).expect(404); // a manager of a different project cannot even see it
    await create(w, w.dev).expect(403);
    await create(w, w.outsider).expect(403);
    const e = (await create(w).expect(201)).body;
    expect(e.version).toBe(1);
    expect(e.status).toBe('draft');
    const r = await save(e._id, w.lead).expect(200);
    expect(r.body.totalHours).toBe(14);
    // the manager sees hours only
    expect(r.body.totalCost).toBeUndefined();
    expect(r.body.lines[0].costRate).toBeUndefined();
    expect(r.body.lines[1].role).toBe('QA Engineer'); // role is normalised to the rate card's spelling
    // Management sees the money: 10 h x 650 + 4 h x 450 = 8,300 rupees
    const full = (await request(app).get(`/api/estimates/${e._id}`).set(w.mgmt.auth).expect(200)).body;
    expect(full.totalCost).toBe(8300_00);
    expect(full.totalBilling).toBe((10 * 1400 + 4 * 1000) * 100);
    expect(full.canEdit).toBe(true);
  });

  it('refuses unknown roles, bad hours and an empty submission', async () => {
    const w = await world();
    const e = (await create(w).expect(201)).body;
    const bad = await save(e._id, w.lead, [{ module: 'X', task: 'Y', role: 'Wizard', hours: 3 }]).expect(400);
    expect(bad.body.error?.message ?? bad.body.message).toMatch(/No rate for Wizard/);
    await save(e._id, w.lead, [{ module: 'X', task: 'Y', role: 'Developer', hours: 0 }]).expect(400);
    await request(app).post(`/api/estimates/${e._id}/submit`).set(w.lead.auth).expect(400); // no lines yet
  });

  it('only one open estimate per project at a time', async () => {
    const w = await world();
    await create(w).expect(201);
    await create(w).expect(409);
  });
});

describe('approval', () => {
  it('submit, approve by a different person, becomes the project budget, and the next version supersedes it', async () => {
    const w = await world();
    const e = (await create(w).expect(201)).body;
    await save(e._id, w.lead).expect(200);
    await request(app).post(`/api/estimates/${e._id}/decision`).set(w.mgmt.auth).send({ decision: 'approved' }).expect(409); // not submitted yet
    await request(app).post(`/api/estimates/${e._id}/submit`).set(w.lead.auth).expect(200);
    await save(e._id, w.lead).expect(409); // locked while waiting
    expect(await Notification.countDocuments({ type: 'estimate.submitted' })).toBeGreaterThanOrEqual(2); // both Management users

    await request(app).post(`/api/estimates/${e._id}/decision`).set(w.lead.auth).send({ decision: 'approved' }).expect(403); // no approve right
    await request(app).post(`/api/estimates/${e._id}/decision`).set(w.mgmt.auth).send({ decision: 'rejected' }).expect(400); // needs a reason
    await request(app).post(`/api/estimates/${e._id}/decision`).set(w.mgmt.auth).send({ decision: 'approved' }).expect(200);
    expect((await Project.findById(w.project._id).lean())!.budgetHours).toBe(14);
    expect(await Notification.countDocuments({ type: 'estimate.decided', user: (await User.findOne({ employee: w.lead.employee._id }))!._id })).toBe(1);

    // version 2 copied from the first, more hours; approving it supersedes v1 and moves the budget
    const v2 = (await create(w, w.lead, { copyFrom: e._id }).expect(201)).body;
    expect(v2.version).toBe(2);
    expect(v2.lines).toHaveLength(2);
    await save(v2._id, w.lead, [...LINES, { module: 'Auth', task: 'SSO', role: 'Developer', hours: 6 }]).expect(200);
    await request(app).post(`/api/estimates/${v2._id}/submit`).set(w.lead.auth).expect(200);
    await request(app).post(`/api/estimates/${v2._id}/decision`).set(w.mgmt2.auth).send({ decision: 'approved' }).expect(200);
    const list = (await request(app).get(`/api/estimates/project/${w.project._id}`).set(w.mgmt.auth).expect(200)).body.items;
    expect(list.map((x: any) => [x.version, x.status])).toEqual([[2, 'approved'], [1, 'superseded']]);
    expect((await Project.findById(w.project._id).lean())!.budgetHours).toBe(20);

    const diff = (await request(app).get(`/api/estimates/${v2._id}/compare`).set(w.mgmt.auth).expect(200)).body;
    expect(diff.added.map((l: any) => l.task)).toEqual(['SSO']);
    expect(diff.removed).toHaveLength(0);
    expect(diff.to.totalCost - diff.from.totalCost).toBe(6 * 650_00);
  });

  it('the submitter cannot approve their own, and a rejection sends it back for editing', async () => {
    const w = await world();
    const e = (await create(w, w.mgmt).expect(201)).body; // Management can draft too
    await save(e._id, w.mgmt).expect(200);
    await request(app).post(`/api/estimates/${e._id}/submit`).set(w.mgmt.auth).expect(200);
    await request(app).post(`/api/estimates/${e._id}/decision`).set(w.mgmt.auth).send({ decision: 'approved' }).expect(403);
    await request(app).post(`/api/estimates/${e._id}/decision`).set(w.mgmt2.auth).send({ decision: 'rejected', comment: 'Too thin on testing' }).expect(200);
    // the rejected one can be edited again and goes back to draft
    const r = await save(e._id, w.lead, [...LINES, { module: 'Auth', task: 'More tests', role: 'QA Engineer', hours: 8 }]).expect(200);
    expect(r.body.status).toBe('draft');
    expect(r.body.totalHours).toBe(22);
  });
});

describe('who sees what', () => {
  it('members see only approved estimates, hours only; outsiders see nothing; HR sees all with cost but cannot edit', async () => {
    const w = await world();
    const e = (await create(w).expect(201)).body;
    await save(e._id, w.lead).expect(200);

    // draft: invisible to a member, who gets an empty list
    expect((await request(app).get(`/api/estimates/project/${w.project._id}`).set(w.dev.auth).expect(200)).body.items).toHaveLength(0);
    await request(app).get(`/api/estimates/${e._id}`).set(w.dev.auth).expect(404);
    await request(app).get(`/api/estimates/project/${w.project._id}`).set(w.outsider.auth).expect(404);
    await request(app).get(`/api/estimates/project/${w.project._id}`).set(w.otherLead.auth).expect(404);

    await request(app).post(`/api/estimates/${e._id}/submit`).set(w.lead.auth).expect(200);
    await request(app).post(`/api/estimates/${e._id}/decision`).set(w.mgmt.auth).send({ decision: 'approved' }).expect(200);

    const asDev = (await request(app).get(`/api/estimates/${e._id}`).set(w.dev.auth).expect(200)).body;
    expect(asDev.totalHours).toBe(14);
    expect(asDev.totalCost).toBeUndefined();
    expect(asDev.lines[0].costRate).toBeUndefined();
    expect(asDev.canEdit).toBe(false);

    const asHr = (await request(app).get(`/api/estimates/${e._id}`).set(w.hr.auth).expect(200)).body;
    expect(asHr.totalCost).toBe(8300_00);
    expect(asHr.canEdit).toBe(false);
    await request(app).put(`/api/estimates/${e._id}`).set(w.hr.auth).send({ lines: LINES }).expect(403);
    await request(app).post(`/api/estimates/project/${w.project._id}`).set(w.hr.auth).send({}).expect(403);
  });
});

describe('estimated vs actual', () => {
  async function approved(w: Awaited<ReturnType<typeof world>>) {
    const e = (await create(w).expect(201)).body;
    await save(e._id, w.lead).expect(200); // Developer 10 h @650 + QA 4 h @450 = 14 h, Rs 8,300
    await request(app).post(`/api/estimates/${e._id}/submit`).set(w.lead.auth).expect(200);
    await request(app).post(`/api/estimates/${e._id}/decision`).set(w.mgmt.auth).send({ decision: 'approved' }).expect(200);
    return e;
  }
  const task = async (w: Awaited<ReturnType<typeof world>>, title: string, estimateModule?: string) =>
    (await request(app).post(`/api/projects/${w.project._id}/tasks`).set(w.lead.auth).send({ title, assignee: id(w.dev), estimateModule }).expect(201)).body;
  const log = (w: Awaited<ReturnType<typeof world>>, who: Person, taskId: string, date: string, hours: number) =>
    TimeLog.create({ employee: who.employee._id, task: taskId, project: w.project._id, date, minutes: hours * 60 });

  it('has nothing to report until an estimate is approved', async () => {
    const w = await world();
    expect((await request(app).get(`/api/estimates/project/${w.project._id}/variance`).set(w.mgmt.auth).expect(200)).body.hasEstimate).toBe(false);
  });

  it('prices hours by role, falls back to the blended rate, and flags the overrun', async () => {
    const w = await world();
    await approved(w);
    await Employee.updateOne({ _id: w.dev.employee._id }, { designation: 'developer' });
    const t1 = await task(w, 'Login screen', 'Auth');
    const t2 = await task(w, 'Misc work');
    await log(w, w.dev, t1._id, '2026-11-02', 8);
    await log(w, w.dev, t1._id, '2026-11-03', 6);
    await log(w, w.lead, t2._id, '2026-11-04', 3); // no matching designation: blended rate

    const v = (await request(app).get(`/api/estimates/project/${w.project._id}/variance`).set(w.mgmt.auth).expect(200)).body;
    expect(v.estimate.totalHours).toBe(14);
    expect(v.actual.hours).toBe(17);
    expect(v.hoursOverPct).toBeCloseTo(21.43, 1);
    expect(v.actual.cost).toBe(14 * 650_00 + Math.round(3 * (8300_00 / 14)));
    expect(v.costOverPct).toBeGreaterThan(25);
    expect(v.flag).toBe('alert');
    expect(v.hoursFlag).toBe('warn');
    const dev = v.byPerson.find((p: any) => p.hours === 14);
    expect(dev).toMatchObject({ role: 'Developer', rateAssumed: false });
    expect(v.byPerson.find((p: any) => p.hours === 3)).toMatchObject({ role: 'Other', rateAssumed: true });
    expect(v.byRole.find((r: any) => r.role === 'Developer')).toMatchObject({ estHours: 10, actHours: 14 });
    expect(v.byModule.find((m: any) => m.module === 'Auth')).toMatchObject({ estHours: 14, actHours: 14 });
    expect(v.byModule.find((m: any) => m.module === '(no module)').actHours).toBe(3);
    expect(v.burn.at(-1).hours).toBe(17);
    expect(v.forecastHours).toBeNull(); // no task is done yet, so no forecast
  });

  it('the project manager sees hours and a hours-based flag, never cost; members see nothing', async () => {
    const w = await world();
    await approved(w);
    const t = await task(w, 'Work');
    await log(w, w.dev, t._id, '2026-11-02', 16);
    const v = (await request(app).get(`/api/estimates/project/${w.project._id}/variance`).set(w.lead.auth).expect(200)).body;
    expect(v.actual).toEqual({ hours: 16 });
    expect(v.flag).toBe('warn'); // 14.3% over on hours
    expect(JSON.stringify(v)).not.toMatch(/cost|Cost/);
    await request(app).get(`/api/estimates/project/${w.project._id}/variance`).set(w.dev.auth).expect(403);
    await request(app).get(`/api/estimates/project/${w.project._id}/variance`).set(w.outsider.auth).expect(404);
  });

  it('forecasts the final hours from progress', async () => {
    const w = await world();
    await approved(w);
    const a = await task(w, 'Done one');
    await request(app).post(`/api/projects/tasks/${a._id}/status`).set(w.lead.auth).send({ status: 'done' }).expect(200);
    const b = await task(w, 'Open one');
    await log(w, w.dev, a._id, '2026-11-02', 5);
    void b;
    const v = (await request(app).get(`/api/estimates/project/${w.project._id}/variance`).set(w.mgmt.auth).expect(200)).body;
    expect(v.progress).toBe(0.5);
    expect(v.forecastHours).toBe(10);
  });

  it('portfolio report lists the project and exports to Excel for cost viewers only', async () => {
    const w = await world();
    await approved(w);
    const rows = (await request(app).get('/api/estimates/report').set(w.hr.auth).expect(200)).body;
    expect(rows.some((r: any) => r.project._id === w.project._id && r.estHours === 14)).toBe(true);
    const x = await request(app).get('/api/estimates/report?format=xlsx').set(w.mgmt.auth).buffer().parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    await request(app).get('/api/estimates/report').set(w.lead.auth).expect(403);
  });
});

describe('comparing versions', () => {
  it('reports lines whose hours changed, with their names intact', async () => {
    const w = await world();
    const v1 = (await create(w).expect(201)).body;
    await save(v1._id, w.lead).expect(200);
    await request(app).post(`/api/estimates/${v1._id}/submit`).set(w.lead.auth).expect(200);
    await request(app).post(`/api/estimates/${v1._id}/decision`).set(w.mgmt.auth).send({ decision: 'approved' }).expect(200);
    const v2 = (await create(w, w.lead, { copyFrom: v1._id }).expect(201)).body;
    await save(v2._id, w.lead, [{ ...LINES[0], hours: 15 }, LINES[1]]).expect(200);
    const d = (await request(app).get(`/api/estimates/${v2._id}/compare`).set(w.mgmt.auth).expect(200)).body;
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]).toMatchObject({ module: 'Auth', task: 'Login screen', role: 'Developer', hours: 15, before: 10 });
    // and a manager sees it without rates
    const m = (await request(app).get(`/api/estimates/${v2._id}/compare`).set(w.lead.auth).expect(200)).body;
    expect(m.changed[0].costRate).toBeUndefined();
    expect(m.to.totalCost).toBeUndefined();
  });
});
