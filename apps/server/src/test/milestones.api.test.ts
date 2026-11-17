import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Notification } from '../modules/notifications/model';
import { notifyMilestones, milestoneState } from '../modules/milestones/service';
import { User } from '../modules/users/model';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);

async function world() {
  const mgmt = await createPerson(roles.Management);
  const hr = await createPerson(roles.HR);
  const lead = await createPerson(roles.Manager);
  const otherLead = await createPerson(roles.Manager);
  const dev = await createPerson(roles.Employee);
  const outsider = await createPerson(roles.Employee);
  const code = `MS-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: 'Milestone project', manager: id(lead), members: [id(dev)], status: 'active' }).expect(201)).body;
  return { mgmt, hr, lead, otherLead, dev, outsider, project };
}
const add = (w: Awaited<ReturnType<typeof world>>, body: object, who: Person = w.lead) =>
  request(app).post(`/api/milestones/project/${w.project._id}`).set(who.auth).send({ name: 'Design signed off', plannedStart: '2026-11-01', plannedEnd: '2026-11-15', ...body });
const list = async (w: Awaited<ReturnType<typeof world>>, who: Person = w.lead) => (await request(app).get(`/api/milestones/project/${w.project._id}`).set(who.auth).expect(200)).body;

describe('milestoneState', () => {
  const m = { plannedStart: '2026-11-01', plannedEnd: '2026-11-15', baselineEnd: '2026-11-15', status: 'planned' };
  it('classifies by date, slip and task progress', () => {
    expect(milestoneState({ ...m, plannedStart: '2026-12-01', plannedEnd: '2026-12-20', baselineEnd: '2026-12-20' }, null, '2026-11-05').state).toBe('upcoming');
    expect(milestoneState(m, 0.5, '2026-11-05').state).toBe('on_track');
    expect(milestoneState(m, 0.5, '2026-11-10').state).toBe('at_risk'); // due within a week, under 70% done
    expect(milestoneState(m, 0.9, '2026-11-10').state).toBe('on_track');
    expect(milestoneState(m, 1, '2026-11-16').state).toBe('late');
    expect(milestoneState({ ...m, plannedEnd: '2026-11-20' }, 1, '2026-11-05')).toEqual({ state: 'at_risk', slipDays: 5 }); // moved past the baseline
    expect(milestoneState({ ...m, status: 'done', doneOn: '2026-11-18' }, 1, '2026-11-30')).toEqual({ state: 'done', slipDays: 3 });
    expect(milestoneState({ ...m, baselineEnd: null }, null, '2026-11-05').slipDays).toBeNull();
  });
});

describe('milestones', () => {
  it('the project manager plans them; members and HR can look but not change', async () => {
    const w = await world();
    await add(w, {}, w.dev).expect(403);
    await add(w, {}, w.hr).expect(403);
    await add(w, {}, w.otherLead).expect(404); // cannot even see the project
    await add(w, { plannedEnd: '2026-10-01' }).expect(400); // ends before it starts
    await add(w, { owner: id(w.outsider) }).expect(400); // owner must be on the project
    const m = (await add(w, { owner: id(w.dev) }).expect(201)).body;
    expect(m.name).toBe('Design signed off');

    for (const who of [w.dev, w.hr, w.mgmt]) expect((await list(w, who)).items).toHaveLength(1);
    expect((await list(w, w.dev)).canEdit).toBe(false);
    expect((await list(w)).canEdit).toBe(true);
    await request(app).get(`/api/milestones/project/${w.project._id}`).set(w.outsider.auth).expect(404);
    await request(app).put(`/api/milestones/${m._id}`).set(w.dev.auth).send({ name: 'x y', plannedStart: '2026-11-01', plannedEnd: '2026-11-02' }).expect(403);
  });

  it('baseline freezes the plan; slipping the end shows as days behind; resetting needs a reason', async () => {
    const w = await world();
    const m = (await add(w, {}).expect(201)).body;
    await request(app).post(`/api/milestones/project/${w.project._id}/baseline`).set(w.dev.auth).send({}).expect(403);
    await request(app).post(`/api/milestones/project/${w.project._id}/baseline`).set(w.lead.auth).send({}).expect(200);
    let l = await list(w);
    expect(l.baselineAt).toBeTruthy();
    expect(l.items[0].slipDays).toBe(0);

    await request(app).put(`/api/milestones/${m._id}`).set(w.lead.auth).send({ name: m.name, plannedStart: '2026-11-01', plannedEnd: '2026-11-22' }).expect(200);
    l = await list(w);
    expect(l.items[0].slipDays).toBe(7);
    expect(l.items[0].baselineEnd).toBe('2026-11-15');

    await request(app).post(`/api/milestones/project/${w.project._id}/baseline`).set(w.lead.auth).send({}).expect(400);
    await request(app).post(`/api/milestones/project/${w.project._id}/baseline`).set(w.lead.auth).send({ reason: 'Client moved the scope' }).expect(200);
    expect((await list(w)).items[0].slipDays).toBe(0);
  });

  it('tasks can be linked to a milestone of the same project, and counted towards its progress', async () => {
    const w = await world();
    const other = await world();
    const m = (await add(w, {}).expect(201)).body;
    const foreign = (await add(other, {}, other.lead).expect(201)).body;
    const task = (title: string, milestone: string | null, status = 'todo') =>
      request(app).post(`/api/projects/${w.project._id}/tasks`).set(w.lead.auth).send({ title, assignee: id(w.dev), milestone, status });
    await task('Wrong project', foreign._id).expect(400);
    await task('One', m._id, 'done').expect(201);
    await task('Two', m._id).expect(201);
    const l = await list(w);
    expect(l.items[0]).toMatchObject({ tasks: 2, tasksDone: 1 });
    expect(l.tasks).toHaveLength(2);

    // deleting the milestone keeps the tasks
    await request(app).delete(`/api/milestones/${m._id}`).set(w.lead.auth).expect(200);
    const tasks = (await request(app).get(`/api/projects/${w.project._id}/tasks`).set(w.lead.auth).expect(200)).body;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t: any) => t.milestone == null)).toBe(true);
  });

  it('marking done records the date; the portfolio lists open projects for HR and Management only', async () => {
    const w = await world();
    const m = (await add(w, {}).expect(201)).body;
    await request(app).put(`/api/milestones/${m._id}`).set(w.lead.auth).send({ name: m.name, plannedStart: m.plannedStart, plannedEnd: m.plannedEnd, status: 'done' }).expect(200);
    const it = (await list(w)).items[0];
    expect(it.status).toBe('done');
    expect(it.doneOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(it.state).toBe('done');

    await request(app).get('/api/milestones/portfolio').set(w.dev.auth).expect(403);
    await request(app).get('/api/milestones/portfolio').set(w.lead.auth).expect(403);
    for (const who of [w.hr, w.mgmt]) {
      const p = (await request(app).get('/api/milestones/portfolio').set(who.auth).expect(200)).body;
      expect(p.projects.some((x: any) => x._id === w.project._id)).toBe(true);
    }
  });

  it('late milestones notify their owner once, however often the check runs', async () => {
    const w = await world();
    await add(w, { name: 'Overdue one', plannedStart: '2026-09-01', plannedEnd: '2026-09-30', owner: id(w.dev) }).expect(201);
    const devUser = (await User.findOne({ employee: w.dev.employee._id }))!._id;
    await notifyMilestones('2026-11-05');
    await notifyMilestones('2026-11-05');
    const n = await Notification.find({ user: devUser, type: 'milestone.late' }).lean();
    expect(n).toHaveLength(1);
    expect(n[0].title).toMatch(/is late/);
  });
});
