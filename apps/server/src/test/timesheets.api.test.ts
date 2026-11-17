import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AttendanceDay } from '../modules/attendance/model';
import { resetClock, setClock, zonedDateTime } from '../utils/time';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);
afterEach(resetClock);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);
const at = (date: string, time: string) => setClock(() => zonedDateTime(date, time));

/** A project led by `lead` with `dev` as a member, and two tasks the dev can log time on. */
async function world() {
  const mgmt = await createPerson(roles.Management);
  const lead = await createPerson(roles.Manager);
  const dev = await createPerson(roles.Employee, { manager: lead.employee._id });
  const outsider = await createPerson(roles.Employee);
  const code = `TS-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: 'Timesheet project', manager: id(lead), members: [id(dev)], status: 'active' }).expect(201)).body;
  const mk = async (title: string) => (await request(app).post(`/api/projects/${project._id}/tasks`).set(lead.auth).send({ title, assignee: id(dev) }).expect(201)).body;
  return { mgmt, lead, dev, outsider, project, a: await mk('Build the form'), b: await mk('Write the tests') };
}

const attend = (p: Person, date: string, extra: Record<string, unknown> = {}) =>
  AttendanceDay.create({
    employee: p.employee._id,
    date,
    status: 'present',
    source: 'self',
    checkIn: zonedDateTime(date, '09:30'),
    checkOut: zonedDateTime(date, '18:30'),
    workedMinutes: 540,
    ...extra,
  });

const log = (p: Person, task: { _id: string }, date: string, minutes: number) => request(app).put('/api/timesheets/log').set(p.auth).send({ task: task._id, date, minutes });

describe('time logs follow attendance', () => {
  it('caps a day at the hours attendance shows plus the allowance, across tasks', async () => {
    const w = await world();
    at('2026-10-23', '12:00');
    await attend(w.dev, '2026-10-13'); // 9 h at work

    await log(w.dev, w.a, '2026-10-13', 300).expect(200);
    const over = await log(w.dev, w.b, '2026-10-13', 300).expect(400); // 300 + 300 > 540 + 30
    expect(over.body.message).toMatch(/at most 4 h 30 m/);
    const filled = (await log(w.dev, w.b, '2026-10-13', 270).expect(200)).body; // exactly the cap
    expect(filled).toMatchObject({ logged: 570, availableMinutes: 540, remaining: 0 });
    await log(w.dev, w.b, '2026-10-13', 271).expect(400);
    // lowering an entry frees the room again; zero removes it
    await log(w.dev, w.a, '2026-10-13', 0).expect(200);
    expect((await log(w.dev, w.b, '2026-10-13', 400).expect(200)).body.logged).toBe(400);

    // the allowance is a setting
    const admin = await createPerson(roles.Admin);
    await request(app).put('/api/timesheets/rules').set(admin.auth).send({ requireApproval: false, toleranceMinutes: 0 }).expect(200);
    await log(w.dev, w.a, '2026-10-13', 141).expect(400); // 400 + 141 > 540
    await log(w.dev, w.a, '2026-10-13', 140).expect(200);
    await request(app).put('/api/timesheets/rules').set(admin.auth).send({ requireApproval: false, toleranceMinutes: 30 }).expect(200);
    await request(app).put('/api/timesheets/rules').set(w.dev.auth).send({ requireApproval: true, toleranceMinutes: 30 }).expect(403);
  });

  it('refuses days with no attendance, week-offs, leave, the future, and people outside the project', async () => {
    const w = await world();
    at('2026-10-23', '12:00');
    await attend(w.dev, '2026-10-13');
    await attend(w.dev, '2026-10-15', { status: 'leave', leave: { fraction: 1, code: 'CL', paid: true }, checkIn: undefined, checkOut: undefined, workedMinutes: 0 });
    await attend(w.dev, '2026-10-16', { checkIn: undefined, checkOut: undefined, workedMinutes: 0, status: 'half', source: 'override', override: { reason: 'half day', at: new Date() } });

    const say = async (date: string, m = 60) => (await log(w.dev, w.a, date, m).expect(400)).body.message as string;
    expect(await say('2026-10-14')).toMatch(/no attendance recorded/); // working day, nobody checked in
    expect(await say('2026-10-11')).toMatch(/week off/); // Sunday
    expect(await say('2026-10-15')).toMatch(/on leave/);
    expect(await say('2026-10-30')).toMatch(/future/);

    // an HR-marked half day with no times counts as a half shift (4 h + allowance)
    await log(w.dev, w.a, '2026-10-16', 270).expect(200);
    await log(w.dev, w.a, '2026-10-16', 271).expect(400);

    await log(w.outsider, w.a, '2026-10-13', 60).expect(404); // not in the project
    await request(app).put('/api/timesheets/log').set(w.dev.auth).send({ task: w.a._id, date: '2026-10-13', minutes: 2000 }).expect(400);
    await request(app).put('/api/timesheets/log').set(w.dev.auth).send({ task: w.a._id, date: 'yesterday', minutes: 5 }).expect(400);

    // a closed project takes no time
    await request(app).put(`/api/projects/${w.project._id}`).set(w.mgmt.auth).send({ code: w.project.code, name: 'Timesheet project', manager: id(w.lead), members: [id(w.dev)], status: 'completed' }).expect(200);
    await log(w.dev, w.a, '2026-10-13', 60).expect(409);
  });

  it('today counts the time since check-in; a locked month cannot change', async () => {
    const w = await world();
    await attend(w.dev, '2026-10-21', { checkOut: undefined, workedMinutes: 0 }); // checked in at 09:30, still working
    at('2026-10-21', '11:30'); // 2 h later
    await log(w.dev, w.a, '2026-10-21', 150).expect(200); // 2 h + 30 min allowance
    await log(w.dev, w.b, '2026-10-21', 1).expect(400);

    at('2026-10-23', '12:00');
    const hr = await createPerson(roles.HR);
    await request(app).post('/api/attendance/locks/2026-10/lock').set(hr.auth).send({}).expect(200);
    const locked = await log(w.dev, w.a, '2026-10-21', 100).expect(423);
    expect(locked.body.message).toMatch(/locked/);
    await request(app).post('/api/attendance/locks/2026-10/unlock').set(hr.auth).send({ reason: 'Reopen for the next tests' }).expect(200);
  });
});

describe('weekly timesheet', () => {
  it('shows each day, my assigned tasks, and totals', async () => {
    const w = await world();
    at('2026-10-23', '12:00');
    await attend(w.dev, '2026-10-13');
    await attend(w.dev, '2026-10-14');
    await log(w.dev, w.a, '2026-10-13', 240).expect(200);
    await log(w.dev, w.b, '2026-10-13', 120).expect(200);
    await log(w.dev, w.a, '2026-10-14', 60).expect(200);

    const grid = (await request(app).get('/api/timesheets/week?start=2026-10-15').set(w.dev.auth).expect(200)).body; // any day in the week works
    expect(grid.weekStart).toBe('2026-10-12'); // the Monday
    expect(grid.days).toHaveLength(7);
    expect(grid.total).toBe(420);
    const day13 = grid.days.find((d: { date: string }) => d.date === '2026-10-13');
    expect(day13).toMatchObject({ logged: 360, availableMinutes: 540, canLog: true, remaining: 210 });
    expect(grid.days.find((d: { date: string }) => d.date === '2026-10-11')).toBeUndefined(); // previous week's Sunday
    expect(grid.days.find((d: { date: string }) => d.date === '2026-10-18')).toMatchObject({ type: 'weekoff', canLog: false });
    const rowA = grid.rows.find((r: { task: { _id: string } }) => r.task._id === w.a._id);
    expect(rowA.minutes).toEqual({ '2026-10-13': 240, '2026-10-14': 60 });
    expect(rowA.total).toBe(300);
    expect(rowA.task.ref).toBe(`${w.project.code}-1`);

    // tasks I could add to the grid
    const options = (await request(app).get('/api/timesheets/tasks').set(w.dev.auth).expect(200)).body;
    expect(options.map((t: { ref: string }) => t.ref).sort()).toEqual([`${w.project.code}-1`, `${w.project.code}-2`]);
    expect((await request(app).get('/api/timesheets/tasks').set(w.outsider.auth).expect(200)).body).toEqual([]);

    // privacy: others cannot read my week; my manager and HR can
    await request(app).get(`/api/timesheets/week?start=2026-10-12&employee=${id(w.dev)}`).set(w.outsider.auth).expect(403);
    await request(app).get(`/api/timesheets/week?start=2026-10-12&employee=${id(w.dev)}`).set(w.lead.auth).expect(200);
    const hr = await createPerson(roles.HR);
    await request(app).get(`/api/timesheets/week?start=2026-10-12&employee=${id(w.dev)}`).set(hr.auth).expect(200);
  });

  it('with approval switched on: submit locks the week, the manager approves or sends back', async () => {
    const w = await world();
    const admin = await createPerson(roles.Admin);
    at('2026-10-23', '12:00');
    await attend(w.dev, '2026-10-13');
    await log(w.dev, w.a, '2026-10-13', 120).expect(200);

    // off by default: nothing to submit
    await request(app).post('/api/timesheets/submit').set(w.dev.auth).send({ weekStart: '2026-10-12' }).expect(400);
    await request(app).put('/api/timesheets/rules').set(admin.auth).send({ requireApproval: true, toleranceMinutes: 30 }).expect(200);

    await request(app).post('/api/timesheets/submit').set(w.dev.auth).send({ weekStart: '2026-10-13' }).expect(400); // not a Monday
    await request(app).post('/api/timesheets/submit').set(w.dev.auth).send({ weekStart: '2026-11-30' }).expect(400); // future
    await request(app).post('/api/timesheets/submit').set(w.dev.auth).send({ weekStart: '2026-10-05' }).expect(400); // nothing logged that week
    const sheet = (await request(app).post('/api/timesheets/submit').set(w.dev.auth).send({ weekStart: '2026-10-12' }).expect(200)).body;
    expect(sheet).toMatchObject({ status: 'submitted', totalMinutes: 120 });

    // locked while waiting
    const locked = await log(w.dev, w.a, '2026-10-13', 180).expect(409);
    expect(locked.body.message).toMatch(/submitted/);
    await request(app).post('/api/timesheets/submit').set(w.dev.auth).send({ weekStart: '2026-10-12' }).expect(409);
    expect((await request(app).get('/api/timesheets/week?start=2026-10-12').set(w.dev.auth)).body).toMatchObject({ locked: true, sheet: { status: 'submitted' } });

    // who may decide
    const pending = (await request(app).get('/api/timesheets/pending').set(w.lead.auth).expect(200)).body;
    expect(pending).toHaveLength(1);
    expect(pending[0].employee.name).toBe(w.dev.employee.name);
    expect((await request(app).get('/api/timesheets/pending').set(w.outsider.auth).expect(200)).body).toEqual([]);
    await request(app).post(`/api/timesheets/${sheet._id}/decision`).set(w.dev.auth).send({ decision: 'approved' }).expect(403); // not your own
    await request(app).post(`/api/timesheets/${sheet._id}/decision`).set(w.outsider.auth).send({ decision: 'approved' }).expect(403);
    await request(app).post(`/api/timesheets/${sheet._id}/decision`).set(w.lead.auth).send({ decision: 'rejected' }).expect(400); // needs a reason
    await request(app).post(`/api/timesheets/${sheet._id}/decision`).set(w.lead.auth).send({ decision: 'rejected', comment: 'Wrong task on Tuesday' }).expect(200);

    // sent back: editable again, with the comment visible, then resubmitted and approved
    expect((await request(app).get('/api/timesheets/week?start=2026-10-12').set(w.dev.auth)).body).toMatchObject({ locked: false, sheet: { status: 'rejected', comment: 'Wrong task on Tuesday' } });
    await log(w.dev, w.a, '2026-10-13', 180).expect(200);
    await request(app).post('/api/timesheets/submit').set(w.dev.auth).send({ weekStart: '2026-10-12' }).expect(200);
    await request(app).post(`/api/timesheets/${sheet._id}/decision`).set(w.lead.auth).send({ decision: 'approved' }).expect(200);
    await request(app).post(`/api/timesheets/${sheet._id}/decision`).set(w.lead.auth).send({ decision: 'approved' }).expect(409); // already decided
    await log(w.dev, w.a, '2026-10-13', 60).expect(409); // approved weeks stay locked
    await request(app).put('/api/timesheets/rules').set(admin.auth).send({ requireApproval: false, toleranceMinutes: 30 }).expect(200);
  });
});

describe('project dashboard', () => {
  it('adds up hours against estimates, workload per person, and what is late or coming', async () => {
    const w = await world();
    at('2026-11-10', '12:00');
    // two tasks with estimates and due dates, plus time on one of them
    await request(app).put(`/api/projects/tasks/${w.a._id}`).set(w.lead.auth).send({ title: w.a.title, assignee: id(w.dev), status: 'in_progress', priority: 'high', estimateHours: 10, dueDate: '2026-11-05' }).expect(200); // overdue
    await request(app).put(`/api/projects/tasks/${w.b._id}`).set(w.lead.auth).send({ title: w.b.title, assignee: id(w.dev), status: 'todo', priority: 'medium', estimateHours: 6, dueDate: '2026-11-12' }).expect(200); // due in two days
    await attend(w.dev, '2026-11-09');
    await attend(w.dev, '2026-11-02');
    await log(w.dev, w.a, '2026-11-09', 240).expect(200); // this week
    await log(w.dev, w.a, '2026-11-02', 120).expect(200); // last week
    await log(w.dev, w.b, '2026-11-09', 60).expect(200);

    const d = (await request(app).get(`/api/projects/${w.project._id}/dashboard`).set(w.lead.auth).expect(200)).body;
    expect(d.hours).toMatchObject({ loggedMinutes: 420, estimateHours: 16, budgetHours: null });
    expect(d.byPerson).toHaveLength(1);
    expect(d.byPerson[0]).toMatchObject({ openTasks: 2, doneTasks: 0, estimateHours: 16, loggedMinutes: 420 });
    expect(d.overdue.map((t: { ref: string }) => t.ref)).toEqual([`${w.project.code}-1`]);
    expect(d.upcoming.map((t: { ref: string }) => t.ref)).toEqual([`${w.project.code}-2`]);
    expect(d.weeks).toHaveLength(8);
    expect(d.weeks[7]).toMatchObject({ weekStart: '2026-11-09', minutes: 300 }); // this week: 240 + 60
    expect(d.weeks[6]).toMatchObject({ weekStart: '2026-11-02', minutes: 120 });

    await request(app).get(`/api/projects/${w.project._id}/dashboard`).set(w.dev.auth).expect(200); // members can look
    await request(app).get(`/api/projects/${w.project._id}/dashboard`).set(w.outsider.auth).expect(404);
  });
});
