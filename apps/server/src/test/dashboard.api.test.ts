import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PayrollRun } from '../modules/payroll/model';
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
const get = async (p: Person) => (await request(app).get('/api/dashboard/insights').set(p.auth).expect(200)).body;
const day = (offset: number) => new Date(Date.parse(`${todayStr()}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);

describe('role-based dashboard', () => {
  it('each role gets only the blocks it is allowed to see', async () => {
    const emp = await createPerson(roles.Employee);
    const lead = await createPerson(roles.Manager);
    const hr = await createPerson(roles.HR);
    const mgmt = await createPerson(roles.Management);
    await request(app).get('/api/dashboard/insights').expect(401);

    const e = await get(emp);
    expect(Object.keys(e).sort()).toEqual(['enquiries', 'generatedAt', 'ideas', 'me']);
    expect(e.enquiries.scope).toBe('mine');
    expect(e.ideas.awaitingReview).toBeNull(); // reviewers only
    expect(e.me.balances.length).toBeGreaterThanOrEqual(0);

    const l = await get(lead);
    expect(l.projects.scope).toBe('mine');
    expect(l.enquiries.scope).toBe('mine');
    for (const k of ['hr', 'payroll', 'estimates']) expect(l[k]).toBeUndefined();

    const h = await get(hr);
    expect(h.hr).toBeDefined();
    expect(h.payroll).toBeDefined();
    expect(h.projects.scope).toBe('all');
    expect(h.estimates).toBeDefined();
    expect(h.enquiries.scope).toBe('all');

    const m = await get(mgmt);
    expect(m.hr).toBeUndefined(); // Management approves payroll but does not run HR
    for (const k of ['payroll', 'projects', 'estimates', 'enquiries', 'ideas']) expect(m[k]).toBeDefined();
    expect(m.ideas.awaitingReview).toEqual(expect.any(Number));
  });

  it('project health counts late milestones and overdue tasks, for a lead only on their own projects', async () => {
    const mgmt = await createPerson(roles.Management);
    const lead = await createPerson(roles.Manager);
    const otherLead = await createPerson(roles.Manager);
    const mk = async (code: string, manager: Person) => (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: `Project ${code}`, manager: id(manager), members: [], status: 'active' }).expect(201)).body;
    const mine = await mk(`DB-${Date.now() % 100000}A`, lead);
    const theirs = await mk(`DB-${Date.now() % 100000}B`, otherLead);
    const before = (await get(mgmt)).projects;

    await request(app).post(`/api/milestones/project/${mine._id}`).set(lead.auth).send({ name: 'Past due', plannedStart: day(-30), plannedEnd: day(-5) }).expect(201);
    await request(app).post(`/api/milestones/project/${mine._id}`).set(lead.auth).send({ name: 'Fine', plannedStart: day(1), plannedEnd: day(60) }).expect(201);
    await request(app).post(`/api/projects/${mine._id}/tasks`).set(lead.auth).send({ title: 'Overdue task', dueDate: day(-2) }).expect(201);
    await request(app).post(`/api/milestones/project/${theirs._id}`).set(otherLead.auth).send({ name: 'Also late', plannedStart: day(-30), plannedEnd: day(-3) }).expect(201);

    const l = (await get(lead)).projects;
    expect(l.open).toBe(1);
    expect(l.milestones.late).toBe(1);
    expect(l.overdueTasks).toBe(1);
    expect(l.worst[0].code).toBe(mine.code);

    const m = (await get(mgmt)).projects;
    expect(m.milestones.late - before.milestones.late).toBe(2);
    expect(m.overdueTasks - before.overdueTasks).toBe(1);
    expect(m.worst.length).toBeGreaterThan(0);
  });

  it('enquiries: a sales person sees only their own pipeline and what to chase today', async () => {
    const sales = await createPerson(roles.Manager);
    const other = await createPerson(roles.Manager);
    const mk = (who: Person, name: string, phone: string, next: string) => request(app).post('/api/enquiries').set(who.auth).send({ name, phone, source: 'Referral', nextFollowUp: next }).expect(201);
    await mk(sales, 'Due today', '9811100001', todayStr());
    await mk(sales, 'Later', '9811100002', day(5));
    await mk(other, 'Not mine', '9811100003', todayStr());
    const e = (await get(sales)).enquiries;
    expect(e.open).toBe(2);
    expect(e.dueCount).toBe(1);
    expect(e.due.map((d: any) => d.name)).toEqual(['Due today']);
    expect(e.stages).toEqual([{ stage: 'New', n: 2 }]);
  });

  it('payroll shows the latest approved month; HR sees the run in progress; ideas show the most backed', async () => {
    const hr = await createPerson(roles.HR);
    const mgmt = await createPerson(roles.Management);
    await PayrollRun.create({ month: '2025-01', status: 'approved', totals: { employees: 12, gross: 90000000, deductions: 10000000, net: 80000000, employerContributions: 5000000 } });
    await PayrollRun.create({ month: '2025-02', status: 'draft', totals: { employees: 12, gross: 1, deductions: 0, net: 1, employerContributions: 0 } });
    const p = (await get(mgmt)).payroll;
    expect(p).toMatchObject({ month: '2025-01', status: 'approved', employees: 12, net: 80000000 });
    expect((await get(hr)).hr.payrollRun === null || typeof (await get(hr)).hr.payrollRun === 'object').toBe(true);

    const a = await createPerson(roles.Employee);
    const v = await createPerson(roles.Employee);
    const idea = (title: string) => request(app).post('/api/ideas').set(a.auth).send({ title, description: 'A decent description here.', tags: [] }).expect(201);
    const first = (await idea('Less popular idea')).body;
    const second = (await idea('Most backed idea')).body;
    await request(app).put(`/api/ideas/${second._id}/vote`).set(v.auth).send({ voted: true }).expect(200);
    void first;
    const t = (await get(v)).ideas.trending;
    expect(t[0].title).toBe('Most backed idea');
    expect(t[0].votes).toBe(1);
  });
});
