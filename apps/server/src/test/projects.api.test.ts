import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);
const projectBody = (manager: Person, extra: Record<string, unknown> = {}) => ({ code: 'PRJ-001', name: 'Website revamp', manager: id(manager), members: [], status: 'active', billingType: 'time_material', ...extra });

describe('clients and projects: who can see and change what', () => {
  it('Management creates a client and a project; membership decides who sees it', async () => {
    const mgmt = await createPerson(roles.Management);
    const hr = await createPerson(roles.HR);
    const lead = await createPerson(roles.Manager);
    const dev = await createPerson(roles.Employee);
    const outsider = await createPerson(roles.Employee);

    // clients: managing needs projects.manage; HR and Management can read the list
    const client = (await request(app).post('/api/projects/clients').set(mgmt.auth).send({ name: 'Zenith Textiles', email: 'buyer@zenith.test', gstin: '33abcde1234f1z5' }).expect(201)).body;
    expect(client.gstin).toBe('33ABCDE1234F1Z5');
    await request(app).post('/api/projects/clients').set(mgmt.auth).send({ name: 'zenith textiles' }).expect(409); // same name, any case
    await request(app).post('/api/projects/clients').set(mgmt.auth).send({ name: 'Bad GST Ltd', gstin: '123' }).expect(400);
    await request(app).post('/api/projects/clients').set(hr.auth).send({ name: 'HR should not add' }).expect(403);
    await request(app).get('/api/projects/clients').set(hr.auth).expect(200);
    await request(app).get('/api/projects/clients').set(dev.auth).expect(403);
    await request(app).put(`/api/projects/clients/${client._id}`).set(mgmt.auth).send({ name: 'Zenith Textiles Pvt Ltd', active: true }).expect(200);

    // project: lead + one member
    const body = projectBody(lead, { members: [id(dev)], client: client._id });
    await request(app).post('/api/projects').set(dev.auth).send(body).expect(403); // an employee cannot create
    await request(app).post('/api/projects').set(mgmt.auth).send({ ...body, code: 'bad code' }).expect(400);
    await request(app).post('/api/projects').set(mgmt.auth).send({ ...body, startDate: '2026-12-01', dueDate: '2026-11-01' }).expect(400);
    await request(app).post('/api/projects').set(mgmt.auth).send({ ...body, members: ['aaaaaaaaaaaaaaaaaaaaaaaa'] }).expect(400); // not an employee
    const created = (await request(app).post('/api/projects').set(mgmt.auth).send(body).expect(201)).body;
    expect(created.members.map(String).sort()).toEqual([id(dev), id(lead)].sort()); // the lead is always a member
    await request(app).post('/api/projects').set(mgmt.auth).send(body).expect(409); // code already used

    // visibility
    const ids = async (p: Person, qs = '') => (await request(app).get(`/api/projects${qs}`).set(p.auth).expect(200)).body.items.map((x: { _id: string }) => x._id);
    expect(await ids(mgmt)).toContain(created._id);
    expect(await ids(hr)).toContain(created._id); // HR sees all
    expect(await ids(lead)).toContain(created._id);
    expect(await ids(dev)).toContain(created._id);
    expect(await ids(outsider)).not.toContain(created._id);
    await request(app).get(`/api/projects/${created._id}`).set(outsider.auth).expect(404); // existence not revealed
    await request(app).get(`/api/projects/${created._id}`).set(dev.auth).expect(200);

    // who may edit
    const edit = (p: Person, extra: object = {}) => request(app).put(`/api/projects/${created._id}`).set(p.auth).send({ ...projectBody(lead, { members: [id(dev)], client: client._id }), ...extra });
    await edit(lead, { description: 'Led by me' }).expect(200);
    await edit(mgmt, { status: 'on_hold' }).expect(200);
    await edit(hr).expect(403); // HR can look, not change
    await edit(dev).expect(403);
    await edit(outsider).expect(404);
    const other = await createPerson(roles.Manager);
    await request(app).put(`/api/projects/${created._id}`).set(other.auth).send(projectBody(lead)).expect(404); // a different Manager is not in it
    await edit(lead, { manager: id(other) }).expect(403); // only Management can reassign the lead
    await edit(mgmt, { manager: id(other) }).expect(200);
  });

  it('a Manager can create only projects they lead, and filters work', async () => {
    const lead = await createPerson(roles.Manager);
    const someone = await createPerson(roles.Manager);
    await request(app).post('/api/projects').set(lead.auth).send(projectBody(someone, { code: 'MGR-1' })).expect(403);
    const mine = (await request(app).post('/api/projects').set(lead.auth).send(projectBody(lead, { code: 'MGR-2', name: 'Mobile app', status: 'planning' })).expect(201)).body;
    const list = async (qs: string) => (await request(app).get(`/api/projects?${qs}`).set(lead.auth).expect(200)).body.items.map((x: { _id: string }) => x._id);
    expect(await list('status=planning')).toContain(mine._id);
    expect(await list('status=completed')).not.toContain(mine._id);
    expect(await list('q=mobile')).toContain(mine._id);
    expect(await list('q=nonexistent')).toEqual([]);
    expect(await list('mine=true')).toContain(mine._id);
    await request(app).get('/api/projects?status=bogus').set(lead.auth).expect(400);
  });
});

describe('tasks', () => {
  async function setup() {
    const mgmt = await createPerson(roles.Management);
    const lead = await createPerson(roles.Manager);
    const dev = await createPerson(roles.Employee);
    const dev2 = await createPerson(roles.Employee);
    const outsider = await createPerson(roles.Employee);
    const code = `T-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const project = (await request(app).post('/api/projects').set(mgmt.auth).send(projectBody(lead, { code, members: [id(dev), id(dev2)], status: 'active' })).expect(201)).body;
    return { mgmt, lead, dev, dev2, outsider, project, code };
  }
  const newTask = (s: Awaited<ReturnType<typeof setup>>, who: Person, extra: object = {}) =>
    request(app).post(`/api/projects/${s.project._id}/tasks`).set(who.auth).send({ title: 'Design login page', priority: 'high', ...extra });

  it('only the project manager creates tasks; numbering is per project; assignees must be members', async () => {
    const s = await setup();
    await newTask(s, s.dev).expect(403);
    await newTask(s, s.outsider).expect(404);
    const a = (await newTask(s, s.lead, { assignee: id(s.dev), dueDate: '2026-11-20', estimateHours: 6 }).expect(201)).body;
    const b = (await newTask(s, s.lead, { title: 'Write API tests' }).expect(201)).body;
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(a.ref).toBe(`${s.code}-1`);
    await newTask(s, s.lead, { assignee: id(s.outsider) }).expect(400); // not a member
    await newTask(s, s.mgmt, { title: 'Added by Management' }).expect(201);
    await newTask(s, s.lead, { title: 'x' }).expect(400); // too short

    // concurrent creation never reuses a number
    const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => newTask(s, s.lead, { title: `Parallel task ${i}` })));
    const numbers = burst.map((r) => r.body.number);
    expect(new Set(numbers).size).toBe(8);
  });

  it('assignees move their own cards; others cannot; done sets completion; dropping reorders the column', async () => {
    const s = await setup();
    const t1 = (await newTask(s, s.lead, { title: 'First card', assignee: id(s.dev) }).expect(201)).body;
    const t2 = (await newTask(s, s.lead, { title: 'Second card', assignee: id(s.dev2) }).expect(201)).body;
    const t3 = (await newTask(s, s.lead, { title: 'Third card', assignee: id(s.dev) }).expect(201)).body;
    const move = (task: { _id: string }, who: Person, status: string, position?: number) =>
      request(app).post(`/api/projects/tasks/${task._id}/status`).set(who.auth).send({ status, position });

    await move(t1, s.dev2, 'in_progress').expect(403); // not the assignee
    await move(t1, s.outsider, 'in_progress').expect(404);
    const done = (await move(t1, s.dev, 'done').expect(200)).body;
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeTruthy();
    expect((await move(t1, s.dev, 'in_progress').expect(200)).body.completedAt).toBeFalsy(); // reopened

    // order inside a column: put t3 above t2 in "todo", t1 is in progress
    await move(t3, s.lead, 'todo', 0).expect(200);
    const todo = (await request(app).get(`/api/projects/${s.project._id}/tasks?status=todo`).set(s.lead.auth).expect(200)).body;
    expect(todo.map((t: { title: string }) => t.title)).toEqual(['Third card', 'Second card']);
    expect(todo.map((t: { position: number }) => t.position)).toEqual([0, 1]);
    await move(t2, s.lead, 'bogus').expect(400);
  });

  it('assignees may not edit or delete; the manager may; comments from anyone in the project; removal is blocked while tasks are open', async () => {
    const s = await setup();
    const t = (await newTask(s, s.lead, { title: 'Review spec', assignee: id(s.dev) }).expect(201)).body;
    const edit = (who: Person) => request(app).put(`/api/projects/tasks/${t._id}`).set(who.auth).send({ title: 'Review spec v2', priority: 'urgent', status: 'todo' });
    await edit(s.dev).expect(403);
    await edit(s.outsider).expect(404);
    expect((await edit(s.lead).expect(200)).body).toMatchObject({ title: 'Review spec v2', priority: 'urgent' });

    await request(app).post(`/api/projects/tasks/${t._id}/comments`).set(s.dev2.auth).send({ text: 'I can pair on this' }).expect(201);
    await request(app).post(`/api/projects/tasks/${t._id}/comments`).set(s.outsider.auth).send({ text: 'let me in' }).expect(404);
    await request(app).post(`/api/projects/tasks/${t._id}/comments`).set(s.dev.auth).send({ text: '' }).expect(400);
    const one = (await request(app).get(`/api/projects/tasks/${t._id}`).set(s.dev.auth).expect(200)).body;
    expect(one.comments).toHaveLength(1);
    expect(one).toMatchObject({ isAssignee: true, canManage: false });

    // cannot remove a member who still has open work
    const body = projectBody(s.lead, { code: s.code, members: [id(s.dev2)] });
    const blocked = await request(app).put(`/api/projects/${s.project._id}`).set(s.mgmt.auth).send(body).expect(409);
    expect(blocked.body.message).toMatch(/open task/);
    await request(app).post(`/api/projects/tasks/${t._id}/status`).set(s.dev.auth).send({ status: 'done' }).expect(200);
    await request(app).put(`/api/projects/${s.project._id}`).set(s.mgmt.auth).send(body).expect(200);

    await request(app).delete(`/api/projects/tasks/${t._id}`).set(s.dev2.auth).expect(403);
    await request(app).delete(`/api/projects/tasks/${t._id}`).set(s.lead.auth).expect(204);
    await request(app).get(`/api/projects/tasks/${t._id}`).set(s.lead.auth).expect(404);
  });

  it('task list filters, "my tasks", and closed projects', async () => {
    const s = await setup();
    await newTask(s, s.lead, { title: 'Overdue one', assignee: id(s.dev), dueDate: '2020-01-01' }).expect(201);
    await newTask(s, s.lead, { title: 'Urgent unassigned', priority: 'urgent' }).expect(201);
    const later = (await newTask(s, s.lead, { title: 'Far future', assignee: id(s.dev), dueDate: '2099-01-01' }).expect(201)).body;
    const list = async (who: Person, qs: string) => (await request(app).get(`/api/projects/${s.project._id}/tasks?${qs}`).set(who.auth).expect(200)).body.map((t: { title: string }) => t.title);
    expect(await list(s.lead, 'due=overdue')).toEqual(['Overdue one']);
    expect(await list(s.lead, 'assignee=none')).toEqual(['Urgent unassigned']);
    expect(await list(s.lead, 'priority=urgent')).toEqual(['Urgent unassigned']);
    expect((await list(s.dev, 'assignee=me')).sort()).toEqual(['Far future', 'Overdue one']);
    expect(await list(s.lead, 'q=far')).toEqual(['Far future']);
    await request(app).get(`/api/projects/${s.project._id}/tasks?status=bogus`).set(s.lead.auth).expect(400);

    const mine = (await request(app).get('/api/projects/my/tasks').set(s.dev.auth).expect(200)).body;
    expect(mine.map((t: { ref: string }) => t.ref).sort()).toEqual([`${s.code}-1`, `${s.code}-3`]);
    expect(mine[0].project.code).toBe(s.code);
    expect((await request(app).get('/api/projects/my/tasks?scope=overdue').set(s.dev.auth).expect(200)).body).toHaveLength(1);
    expect((await request(app).get('/api/projects/my/tasks').set(s.outsider.auth).expect(200)).body).toHaveLength(0);

    // project stats count what is there
    const detail = (await request(app).get(`/api/projects/${s.project._id}`).set(s.lead.auth).expect(200)).body;
    expect(detail.stats).toMatchObject({ total: 3, done: 0, overdue: 1 });
    expect(detail.stats.byStatus.todo).toBe(3);

    // a completed project takes no new tasks
    await request(app).put(`/api/projects/${s.project._id}`).set(s.mgmt.auth).send(projectBody(s.lead, { code: s.code, members: [id(s.dev), id(s.dev2)], status: 'completed' })).expect(200);
    await newTask(s, s.lead, { title: 'Too late' }).expect(409);
    void later;
  });
});
