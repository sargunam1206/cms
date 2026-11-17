import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Notification } from '../modules/notifications/model';
import { notifyFollowUps } from '../modules/enquiries/service';
import { Client, Project } from '../modules/projects/model';
import { Role, User } from '../modules/users/model';
import { todayStr } from '../utils/time';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);
const future = (days: number) => new Date(Date.parse(`${todayStr()}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
let phoneSeq = 9000000000;
const phone = () => `+91 ${String(++phoneSeq).replace(/(\d{5})(\d{5})/, '$1 $2')}`;

async function world() {
  return {
    mgmt: await createPerson(roles.Management),
    hr: await createPerson(roles.HR),
    sales: await createPerson(roles.Manager),
    sales2: await createPerson(roles.Manager),
    emp: await createPerson(roles.Employee),
    bare: await createPerson((await Role.create({ name: `Bare ${Math.random()}`, permissions: ['tasks.self'] }))._id), // a role with no enquiry right at all
  };
}
type W = Awaited<ReturnType<typeof world>>;
const make = (who: Person, body: object = {}) => request(app).post('/api/enquiries').set(who.auth).send({ name: 'Arun Kumar', phone: phone(), source: 'Referral', nextFollowUp: future(3), company: 'Arun Traders', ...body });

describe('creating', () => {
  it('needs the enquiries right; starts in the first stage; owner is the creator', async () => {
    const w = await world();
    await make(w.bare).expect(403);
    expect(String((await make(w.emp).expect(201)).body.owner)).toBe(id(w.emp)); // an ordinary employee can log a lead, owned by them
    await make(w.hr).expect(403); // HR can look but not create
    const e = (await make(w.sales).expect(201)).body;
    expect(e.status).toBe('New');
    expect(String(e.owner)).toBe(id(w.sales));
    expect(e.activity[0].kind).toBe('created');
  });

  it('validates the phone, source and follow-up date', async () => {
    const w = await world();
    await make(w.sales, { phone: '12345' }).expect(400);
    await make(w.sales, { source: 'Carrier pigeon' }).expect(400);
    await make(w.sales, { nextFollowUp: '2020-01-01' }).expect(400);
    await make(w.sales, { nextFollowUp: undefined }).expect(400); // required
    await make(w.sales, { status: 'Won' }).expect(400); // cannot start closed
  });

  it('refuses a duplicate phone however it is typed, but a Lost one may come back', async () => {
    const w = await world();
    const p = phone();
    await make(w.sales, { phone: p }).expect(201);
    const digits = p.replace(/\D/g, '').slice(-10);
    const dup = await make(w.sales2, { phone: digits, name: 'Someone else' }).expect(409);
    expect(JSON.stringify(dup.body)).toMatch(/Arun Kumar/);
    await make(w.sales2, { phone: `0${digits}` }).expect(409);

    // the live check tells everyone, but only gives a link to people who may open it
    const check = (who: Person) => request(app).get('/api/enquiries/check').query({ phone: digits }).set(who.auth).expect(200);
    expect((await check(w.sales)).body.matches[0]._id).toBeTruthy();
    const other = (await check(w.sales2)).body.matches[0];
    expect(other.name).toBe('Arun Kumar');
    expect(other._id).toBeUndefined();

    const e = (await request(app).get('/api/enquiries').query({ q: digits }).set(w.mgmt.auth).expect(200)).body.items[0];
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Lost', lostReason: 'Price' }).expect(200);
    await make(w.sales2, { phone: digits }).expect(201);
  });

  it('only managers can start one for someone else', async () => {
    const w = await world();
    await make(w.sales, { owner: id(w.sales2) }).expect(403);
    const e = (await make(w.mgmt, { owner: id(w.sales2) }).expect(201)).body;
    expect(String(e.owner)).toBe(id(w.sales2));
  });
});

describe('who sees what', () => {
  it('sales people see their own; Management and HR see all; HR cannot change anything', async () => {
    const w = await world();
    const mine = (await make(w.sales).expect(201)).body;
    const theirs = (await make(w.sales2).expect(201)).body;
    const ids = async (who: Person) => (await request(app).get('/api/enquiries').query({ limit: 500 }).set(who.auth).expect(200)).body.items.map((x: any) => x._id);
    expect(await ids(w.sales)).toContain(mine._id);
    expect(await ids(w.sales)).not.toContain(theirs._id);
    for (const who of [w.mgmt, w.hr]) expect(await ids(who)).toEqual(expect.arrayContaining([mine._id, theirs._id]));
    await request(app).get(`/api/enquiries/${theirs._id}`).set(w.sales.auth).expect(404);
    await request(app).get(`/api/enquiries/${theirs._id}`).set(w.hr.auth).expect(200);
    await request(app).post(`/api/enquiries/${theirs._id}/notes`).set(w.hr.auth).send({ text: 'hello' }).expect(403);
    await request(app).post(`/api/enquiries/${theirs._id}/notes`).set(w.sales.auth).send({ text: 'hello' }).expect(404);
    await request(app).get('/api/enquiries').set(w.bare.auth).expect(403);
    const empList = (await request(app).get('/api/enquiries').set(w.emp.auth).expect(200)).body.items;
    expect(empList.every((x: any) => String(x.owner?._id) === id(w.emp))).toBe(true); // an employee sees only their own
  });
});

describe('working an enquiry', () => {
  it('notes, follow-up dates and stage changes are logged; open stages keep a follow-up', async () => {
    const w = await world();
    const e = (await make(w.sales).expect(201)).body;
    await request(app).post(`/api/enquiries/${e._id}/notes`).set(w.sales.auth).send({ text: 'Spoke to him, wants a quote', nextFollowUp: future(7) }).expect(200);
    const s = await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Proposal sent' }).expect(200);
    expect(s.body.nextFollowUp).toBe(future(7)); // kept
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Nonsense' }).expect(400);
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Proposal sent' }).expect(400); // no change
    await request(app).post(`/api/enquiries/${e._id}/notes`).set(w.sales.auth).send({ text: 'x', nextFollowUp: '2020-01-01' }).expect(400);
    const d = (await request(app).get(`/api/enquiries/${e._id}`).set(w.sales.auth).expect(200)).body;
    expect(d.activity.map((a: any) => a.kind)).toEqual(['created', 'note', 'followup', 'status']);
    expect(d.activity[3].text).toBe('New → Proposal sent');
    expect(d.canWrite).toBe(true);
  });

  it('Lost needs a known reason and clears the follow-up; reopening needs a new date', async () => {
    const w = await world();
    const e = (await make(w.sales).expect(201)).body;
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Lost' }).expect(400);
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Lost', lostReason: 'Aliens' }).expect(400);
    const lost = (await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Lost', lostReason: 'Price' }).expect(200)).body;
    expect(lost.nextFollowUp).toBeUndefined();
    expect(lost.closedAt).toBeTruthy();
    await request(app).put(`/api/enquiries/${e._id}`).set(w.sales.auth).send({ nextFollowUp: future(2) }).expect(400); // closed: no follow-up
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Contacted' }).expect(400); // needs a date
    const re = (await request(app).post(`/api/enquiries/${e._id}/status`).set(w.sales.auth).send({ status: 'Contacted', nextFollowUp: future(2) }).expect(200)).body;
    expect(re.lostReason).toBeUndefined();
    expect(re.closedAt).toBeUndefined();
  });

  it('only managers reassign; a changed phone is re-checked for duplicates', async () => {
    const w = await world();
    const a = (await make(w.sales).expect(201)).body;
    const b = (await make(w.sales).expect(201)).body;
    await request(app).put(`/api/enquiries/${a._id}`).set(w.sales.auth).send({ owner: id(w.sales2) }).expect(403);
    await request(app).put(`/api/enquiries/${a._id}`).set(w.sales.auth).send({ phone: b.phone }).expect(409);
    const r = (await request(app).put(`/api/enquiries/${a._id}`).set(w.mgmt.auth).send({ owner: id(w.sales2) }).expect(200)).body;
    expect(String(r.owner)).toBe(id(w.sales2));
    expect(r.activity.at(-1).text).toMatch(/Reassigned to/);
    await request(app).get(`/api/enquiries/${a._id}`).set(w.sales.auth).expect(404); // no longer theirs
  });
});

describe('convert to project', () => {
  it('turns a Won enquiry into a client and a project once, and locks it', async () => {
    const w = await world();
    const e = (await make(w.mgmt, { company: 'Zenith Mills' }).expect(201)).body;
    const body = { projectCode: 'zen-01', projectName: 'Zenith portal', manager: id(w.sales) };
    await request(app).post(`/api/enquiries/${e._id}/convert`).set(w.mgmt.auth).send(body).expect(409); // not Won yet
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.mgmt.auth).send({ status: 'Won' }).expect(200);
    await request(app).post(`/api/enquiries/${e._id}/convert`).set(w.sales.auth).send(body).expect(404); // not their enquiry
    const r = (await request(app).post(`/api/enquiries/${e._id}/convert`).set(w.mgmt.auth).send(body).expect(201)).body;
    expect(r.project.code).toBe('ZEN-01');
    expect(r.client.name).toBe('Zenith Mills');
    expect((await Project.findById(r.project._id).lean())!.status).toBe('planning');
    await request(app).post(`/api/enquiries/${e._id}/convert`).set(w.mgmt.auth).send({ ...body, projectCode: 'ZEN-02' }).expect(409); // only once
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.mgmt.auth).send({ status: 'Contacted', nextFollowUp: future(1) }).expect(409);
    await request(app).delete(`/api/enquiries/${e._id}`).set(w.mgmt.auth).expect(409);
    const d = (await request(app).get(`/api/enquiries/${e._id}`).set(w.mgmt.auth).expect(200)).body;
    expect(d.project.code).toBe('ZEN-01');
    expect(d.canConvert).toBe(false);
  });

  it('reuses an existing client by name, refuses a taken project code, and a Manager can only lead their own', async () => {
    const w = await world();
    await Client.create({ name: 'Existing Co' });
    const e = (await make(w.mgmt, { company: 'existing co' }).expect(201)).body;
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.mgmt.auth).send({ status: 'Won' }).expect(200);
    await request(app).post(`/api/enquiries/${e._id}/convert`).set(w.mgmt.auth).send({ projectCode: 'ZEN-01', projectName: 'Clash', manager: id(w.sales) }).expect(409);
    const r = (await request(app).post(`/api/enquiries/${e._id}/convert`).set(w.mgmt.auth).send({ projectCode: 'EXI-01', projectName: 'Existing work', manager: id(w.sales) }).expect(201)).body;
    expect(await Client.countDocuments({ name: /^existing co$/i })).toBe(1);
    expect(r.client.name).toBe('Existing Co');

    // a sales Manager converting their own Won enquiry must lead the project themselves
    const mine = (await make(w.sales).expect(201)).body;
    await request(app).post(`/api/enquiries/${mine._id}/status`).set(w.sales.auth).send({ status: 'Won' }).expect(200);
    await request(app).post(`/api/enquiries/${mine._id}/convert`).set(w.sales.auth).send({ projectCode: 'MINE-1', projectName: 'Mine', manager: id(w.sales2) }).expect(403);
    await request(app).post(`/api/enquiries/${mine._id}/convert`).set(w.sales.auth).send({ projectCode: 'MINE-1', projectName: 'Mine', manager: id(w.sales) }).expect(201);
  });
});

describe('dropdown values and summary', () => {
  it('managers edit the values; a stage in use cannot be removed; Won and Lost are fixed', async () => {
    const w = await world();
    await make(w.sales, { status: 'Contacted' }).expect(201);
    const cur = (await request(app).get('/api/enquiries/options').set(w.sales.auth).expect(200)).body;
    expect(cur.stages).toContain('Contacted');
    const put = (who: Person, body: object) => request(app).put('/api/enquiries/options').set(who.auth).send(body);
    const next = { sources: [...cur.sources, 'Newspaper'], stages: [...cur.stages, 'Quoted'], lostReasons: cur.lostReasons };
    await put(w.sales, next).expect(403);
    await put(w.mgmt, { ...next, stages: ['New', 'Won'] }).expect(400);
    await put(w.mgmt, { ...next, stages: ['New', 'new'] }).expect(400);
    await put(w.mgmt, { ...next, stages: next.stages.filter((s: string) => s !== 'Contacted') }).expect(409); // Contacted is still in use
    await put(w.mgmt, next).expect(200);
    await make(w.sales, { source: 'Newspaper' }).expect(201);
  });

  it('summarises per scope: counts, due today, overdue, conversion', async () => {
    const w = await world();
    const a = (await make(w.sales, { nextFollowUp: todayStr() }).expect(201)).body;
    const b = (await make(w.sales).expect(201)).body;
    await request(app).post(`/api/enquiries/${b._id}/status`).set(w.sales.auth).send({ status: 'Won' }).expect(200);
    const c = (await make(w.sales).expect(201)).body;
    await request(app).post(`/api/enquiries/${c._id}/status`).set(w.sales.auth).send({ status: 'Lost', lostReason: 'Timing' }).expect(200);
    void a;
    const s = (await request(app).get('/api/enquiries/summary').set(w.sales.auth).expect(200)).body;
    expect(s).toMatchObject({ open: 1, dueToday: 1, overdue: 0, won: 1, lost: 1, conversionRate: 50 });
    const all = (await request(app).get('/api/enquiries/summary').set(w.mgmt.auth).expect(200)).body;
    expect(all.won).toBeGreaterThanOrEqual(1);
    const due = (await request(app).get('/api/enquiries').query({ due: 'today', owner: 'me' }).set(w.sales.auth).expect(200)).body;
    expect(due.items).toHaveLength(1);
  });
});

describe('follow-up reminders', () => {
  it('tell the owner once a day about due and overdue enquiries, never about closed ones', async () => {
    const w = await world();
    const e = (await make(w.sales, { name: 'Due Person', nextFollowUp: future(1) }).expect(201)).body;
    const closed = (await make(w.sales, { name: 'Closed Person', nextFollowUp: future(1) }).expect(201)).body;
    await request(app).post(`/api/enquiries/${closed._id}/status`).set(w.sales.auth).send({ status: 'Lost', lostReason: 'Price' }).expect(200);
    const user = (await User.findOne({ employee: w.sales.employee._id }))!._id;
    await notifyFollowUps(future(1));
    await notifyFollowUps(future(1)); // same day again: no repeat
    const n = await Notification.find({ user, type: 'enquiry.followup' }).lean();
    expect(n).toHaveLength(1);
    expect(n[0].title).toMatch(/Due Person/);
    expect(n[0].body).toBe('Due today');
    await notifyFollowUps(future(3)); // two days later it is overdue
    const after = await Notification.find({ user, type: 'enquiry.followup' }).sort({ createdAt: 1 }).lean();
    expect(after).toHaveLength(2);
    expect(after[1].body).toMatch(/Was due/);
    void e;
  });
});

describe('simultaneous changes', () => {
  it('many notes and a status change at the same moment all succeed and none is lost', async () => {
    const w = await world();
    const e = (await make(w.sales).expect(201)).body;
    const notes = Array.from({ length: 8 }, (_, i) => request(app).post(`/api/enquiries/${e._id}/notes`).set((i % 2 ? w.mgmt : w.sales).auth).send({ text: `Note ${i}` }));
    const status = request(app).post(`/api/enquiries/${e._id}/status`).set(w.mgmt.auth).send({ status: 'Contacted' });
    const results = await Promise.all([...notes, status]);
    expect(results.map((r) => r.status)).toEqual(Array(9).fill(200));
    const d = (await request(app).get(`/api/enquiries/${e._id}`).set(w.mgmt.auth).expect(200)).body;
    expect(d.activity.filter((a: any) => a.kind === 'note')).toHaveLength(8);
    expect(d.status).toBe('Contacted');
  });

  it('two simultaneous conversions create only one project', async () => {
    const w = await world();
    const e = (await make(w.mgmt).expect(201)).body;
    await request(app).post(`/api/enquiries/${e._id}/status`).set(w.mgmt.auth).send({ status: 'Won' }).expect(200);
    const body = (code: string) => ({ projectCode: code, projectName: 'Race project', manager: id(w.sales) });
    const [a, b] = await Promise.all([request(app).post(`/api/enquiries/${e._id}/convert`).set(w.mgmt.auth).send(body('RACE-A')), request(app).post(`/api/enquiries/${e._id}/convert`).set(w.mgmt.auth).send(body('RACE-B'))]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await Project.countDocuments({ code: { $in: ['RACE-A', 'RACE-B'] } })).toBe(1); // the loser cleaned up
  });
});

describe('a manager sees the enquiries of the people who report to them', () => {
  it('read-only, direct reports only, and nobody else', async () => {
    const boss = await createPerson(roles.Manager);
    const rep1 = await createPerson(roles.Employee, { manager: boss.employee._id });
    const rep2 = await createPerson(roles.Employee, { manager: boss.employee._id });
    const grand = await createPerson(roles.Employee, { manager: rep1.employee._id }); // reports to rep1, not to boss
    const stranger = await createPerson(roles.Employee);
    const mine = (await make(boss).expect(201)).body;
    const a = (await make(rep1).expect(201)).body;
    const b = (await make(rep2).expect(201)).body;
    const g = (await make(grand).expect(201)).body;
    const s = (await make(stranger).expect(201)).body;

    const ids = async (who: Person, q: object = {}) => (await request(app).get('/api/enquiries').query({ limit: 500, ...q }).set(who.auth).expect(200)).body.items.map((x: any) => x._id);
    const seen = await ids(boss);
    expect(seen).toEqual(expect.arrayContaining([mine._id, a._id, b._id]));
    expect(seen).not.toContain(g._id); // direct reports only, like approvals and attendance
    expect(seen).not.toContain(s._id);

    // narrowing by owner works within what they may see, and cannot be used to reach outside it
    expect(await ids(boss, { owner: id(rep1) })).toEqual([a._id]);
    expect(await ids(boss, { owner: id(stranger) })).toEqual([]);
    expect(await ids(boss, { owner: 'me' })).toEqual([mine._id]);

    // they can open it, but not change it
    const d = (await request(app).get(`/api/enquiries/${a._id}`).set(boss.auth).expect(200)).body;
    expect(d.canWrite).toBe(false);
    await request(app).post(`/api/enquiries/${a._id}/notes`).set(boss.auth).send({ text: 'Let me add this' }).expect(403);
    await request(app).post(`/api/enquiries/${a._id}/status`).set(boss.auth).send({ status: 'Contacted' }).expect(403);
    await request(app).put(`/api/enquiries/${a._id}`).set(boss.auth).send({ name: 'Renamed' }).expect(403);
    await request(app).get(`/api/enquiries/${g._id}`).set(boss.auth).expect(404);
    await request(app).get(`/api/enquiries/${s._id}`).set(boss.auth).expect(404);

    // the employee still sees only their own; the manager's counts include the team
    expect(await ids(rep2)).toEqual([b._id]); // no reports of their own: only their own enquiry
    expect((await ids(rep1)).sort()).toEqual([a._id, g._id].sort()); // rep1 is a manager too, of grand
    const sum = (await request(app).get('/api/enquiries/summary').set(boss.auth).expect(200)).body;
    expect(sum.open).toBe(3);
    const opts = (who: Person) => request(app).get('/api/enquiries/options').set(who.auth).expect(200);
    expect((await opts(boss)).body.viewsOthers).toBe(true);
    expect((await opts(rep1)).body.viewsOthers).toBe(true); // rep1 has grand reporting to them
    expect((await opts(stranger)).body.viewsOthers).toBe(false);

    // the duplicate check links only what they may open
    const m = (await request(app).get('/api/enquiries/check').query({ phone: a.phone }).set(boss.auth).expect(200)).body.matches[0];
    expect(m._id).toBe(a._id);
    expect((await request(app).get('/api/enquiries/check').query({ phone: s.phone }).set(boss.auth).expect(200)).body.matches[0]._id).toBeUndefined();

    // the dashboard says it is the team's
    const dash = (await request(app).get('/api/dashboard/insights').set(boss.auth).expect(200)).body;
    expect(dash.enquiries.scope).toBe('team');
    expect(dash.enquiries.open).toBe(3);
  });
});
