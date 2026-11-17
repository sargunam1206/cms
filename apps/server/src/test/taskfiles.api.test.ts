import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';
import { MAX_FILES_PER_TASK, TaskFile } from '../modules/projects/files';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

type Person = Awaited<ReturnType<typeof createPerson>>;
const id = (p: Person) => String(p.employee._id);

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj <<>> endobj\n'.repeat(20))]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 2)]);
const CSV = Buffer.from('name,hours\nAsha,4\nRavi,6\n');

async function world() {
  const mgmt = await createPerson(roles.Management);
  const lead = await createPerson(roles.Manager);
  const dev = await createPerson(roles.Employee);
  const other = await createPerson(roles.Employee); // member, but not the assignee
  const outsider = await createPerson(roles.Employee);
  const code = `FL-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const project = (await request(app).post('/api/projects').set(mgmt.auth).send({ code, name: 'Files project', manager: id(lead), members: [id(dev), id(other)], status: 'active' }).expect(201)).body;
  const task = (await request(app).post(`/api/projects/${project._id}/tasks`).set(lead.auth).send({ title: 'Task with files', assignee: id(dev) }).expect(201)).body;
  return { mgmt, lead, dev, other, outsider, project, task };
}
type W = Awaited<ReturnType<typeof world>>;
const up = (w: W, who: Person, name: string, body: Buffer, type = 'application/octet-stream') => request(app).post(`/api/projects/tasks/${w.task._id}/files`).query({ name }).set(who.auth).set('Content-Type', type).send(body);
const list = async (w: W, who: Person) => (await request(app).get(`/api/projects/tasks/${w.task._id}/files`).set(who.auth).expect(200)).body;

describe('task attachments', () => {
  it('accepts pdf, images, spreadsheets and csv from the manager and the assignee, with sizes and names', async () => {
    const w = await world();
    expect((await up(w, w.lead, 'Brief.pdf', PDF, 'application/pdf').expect(201)).body).toMatchObject({ name: 'Brief.pdf', mime: 'application/pdf', size: PDF.length });
    await up(w, w.dev, 'screenshot.PNG', PNG, 'image/png').expect(201);
    await up(w, w.dev, 'Estimate sheet.xlsx', XLSX).expect(201);
    await up(w, w.dev, 'hours.csv', CSV, 'text/csv').expect(201);
    const l = await list(w, w.lead);
    expect(l.items.map((f: any) => f.name)).toEqual(['Brief.pdf', 'screenshot.PNG', 'Estimate sheet.xlsx', 'hours.csv']);
    expect(l.items[1].mime).toBe('image/png');
    expect(l.items[0].uploadedByName).toBeTruthy();
    expect(l.allowed).toEqual(expect.arrayContaining(['pdf', 'png', 'xlsx', 'csv']));
  });

  it('downloads the exact bytes as an attachment, never inline', async () => {
    const w = await world();
    const f = (await up(w, w.dev, 'data.csv', CSV, 'text/csv').expect(201)).body;
    const r = await request(app).get(`/api/projects/tasks/${w.task._id}/files/${f._id}`).set(w.other.auth).buffer().parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(Buffer.compare(r.body as Buffer, CSV)).toBe(0);
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="data.csv"/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-type']).toContain('text/csv');
  });

  it('refuses unsafe types and files that are not what their name says', async () => {
    const w = await world();
    for (const name of ['run.exe', 'page.html', 'logo.svg', 'script.js', 'noextension']) await up(w, w.lead, name, Buffer.from('hello world')).expect(400);
    await up(w, w.lead, 'fake.pdf', Buffer.from('this is just text')).expect(400);
    await up(w, w.lead, 'fake.png', PDF).expect(400);
    await up(w, w.lead, 'fake.xlsx', CSV).expect(400);
    await up(w, w.lead, 'bad.csv', Buffer.from([0x61, 0x00, 0x62])).expect(400); // NUL bytes: not text
    await up(w, w.lead, 'empty.pdf', Buffer.alloc(0)).expect(400);
    expect((await list(w, w.lead)).items).toHaveLength(0);
  });

  it('cleans path tricks out of the name', async () => {
    const w = await world();
    const f = (await up(w, w.lead, '..\\..\\evil/../notes.csv', CSV).expect(201)).body;
    expect(f.name).not.toMatch(/[\\/]/);
    expect(f.name.endsWith('notes.csv')).toBe(true);
  });

  it('enforces the size and the count limits', async () => {
    const w = await world();
    const big = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(10 * 1024 * 1024 + 10, 1)]);
    await up(w, w.lead, 'big.pdf', big, 'application/pdf').expect(413);
    for (let i = 0; i < MAX_FILES_PER_TASK; i++) await up(w, w.lead, `f${i}.csv`, CSV).expect(201);
    await up(w, w.lead, 'one-too-many.csv', CSV).expect(409);
  });

  it('only the manager and the assignee attach; every member downloads; outsiders see nothing', async () => {
    const w = await world();
    await up(w, w.other, 'mine.csv', CSV).expect(403); // a member, not the assignee
    await up(w, w.outsider, 'mine.csv', CSV).expect(404);
    const f = (await up(w, w.dev, 'plan.csv', CSV).expect(201)).body;
    await request(app).get(`/api/projects/tasks/${w.task._id}/files/${f._id}`).set(w.other.auth).expect(200);
    await request(app).get(`/api/projects/tasks/${w.task._id}/files/${f._id}`).set(w.outsider.auth).expect(404);
    await request(app).get(`/api/projects/tasks/${w.task._id}/files`).set(w.outsider.auth).expect(404);
    expect((await list(w, w.other)).canUpload).toBe(false);
    expect((await list(w, w.dev)).canUpload).toBe(true);
    expect((await list(w, w.mgmt)).canUpload).toBe(true);
  });

  it('removal: the uploader or the manager; and deleting a task deletes its files', async () => {
    const w = await world();
    const a = (await up(w, w.dev, 'a.csv', CSV).expect(201)).body;
    const b = (await up(w, w.lead, 'b.csv', CSV).expect(201)).body;
    const del = (who: Person, f: any) => request(app).delete(`/api/projects/tasks/${w.task._id}/files/${f._id}`).set(who.auth);
    await del(w.other, a).expect(403);
    await del(w.dev, b).expect(403); // the assignee cannot remove the manager's file
    await del(w.dev, a).expect(200); // but can remove their own
    await del(w.lead, b).expect(200);
    expect((await list(w, w.lead)).items).toHaveLength(0);

    await up(w, w.dev, 'c.csv', CSV).expect(201);
    await request(app).delete(`/api/projects/tasks/${w.task._id}`).set(w.lead.auth).expect(204);
    expect(await TaskFile.countDocuments({ task: w.task._id })).toBe(0);
  });

  it('files cannot be added to a closed project', async () => {
    const w = await world();
    await request(app).put(`/api/projects/${w.project._id}`).set(w.mgmt.auth).send({ code: w.project.code, name: 'Files project', manager: id(w.lead), members: [id(w.dev), id(w.other)], status: 'completed' }).expect(200);
    await up(w, w.lead, 'late.csv', CSV).expect(409);
  });
});
