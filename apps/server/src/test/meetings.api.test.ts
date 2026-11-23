import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Meeting } from '../modules/meetings/model';
import { notifyMeetingReminders } from '../modules/meetings/service';
import { Notification } from '../modules/notifications/model';
import { User } from '../modules/users/model';
import { resetClock, setClock, todayStr } from '../utils/time';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);
afterEach(resetClock);

type Person = Awaited<ReturnType<typeof createPerson>>;
const userOf = async (p: Person) => (await User.findOne({ employee: p.employee._id }))!._id;
const inbox = async (p: Person, type: string) => Notification.find({ user: await userOf(p), type }).lean();

async function world() {
  return {
    org: await createPerson(roles.Employee),
    guest: await createPerson(roles.Employee),
    outsider: await createPerson(roles.Employee),
    mgmt: await createPerson(roles.Management),
  };
}
const base = (w: Awaited<ReturnType<typeof world>>, extra: object = {}) => ({
  title: 'Kitchen layout review',
  type: 'interior_site_visit',
  date: '2027-03-10',
  start: '10:00',
  end: '11:00',
  location: 'Client site, Adyar',
  attendees: [String(w.guest.employee._id)],
  guests: 'Mr. Raman (client)',
  agenda: 'Finalise cabinet layout',
  actions: [],
  ...extra,
});

describe('scheduling', () => {
  it('anyone can schedule; invitees are notified and can see it; others cannot', async () => {
    const w = await world();
    const m = (await request(app).post('/api/meetings').set(w.org.auth).send(base(w)).expect(201)).body;
    expect(String(m.organizer)).toBe(String(w.org.employee._id));
    expect(await inbox(w.guest, 'meeting.invited')).toHaveLength(1);

    const seen = (await request(app).get(`/api/meetings/${m._id}`).set(w.guest.auth).expect(200)).body;
    expect(seen.canEdit).toBe(false);
    await request(app).get(`/api/meetings/${m._id}`).set(w.outsider.auth).expect(404);

    const mine = (await request(app).get('/api/meetings').set(w.outsider.auth).expect(200)).body;
    expect(mine.items.find((x: { _id: string }) => x._id === m._id)).toBeUndefined();
    const all = (await request(app).get('/api/meetings').set(w.mgmt.auth).expect(200)).body;
    expect(all.items.some((x: { _id: string }) => x._id === m._id)).toBe(true);
  });

  it('rejects an end before the start', async () => {
    const w = await world();
    await request(app).post('/api/meetings').set(w.org.auth).send(base(w, { start: '12:00', end: '11:00' })).expect(400);
  });

  it('only the organiser (or meetings.manage) can edit; new invitees and time changes are announced', async () => {
    const w = await world();
    const m = (await request(app).post('/api/meetings').set(w.org.auth).send(base(w)).expect(201)).body;
    await request(app).put(`/api/meetings/${m._id}`).set(w.guest.auth).send(base(w, { title: 'Hijack' })).expect(403);

    await request(app).put(`/api/meetings/${m._id}`).set(w.org.auth).send(base(w, { start: '15:00', end: '16:00', attendees: [String(w.guest.employee._id), String(w.outsider.employee._id)] })).expect(200);
    expect(await inbox(w.outsider, 'meeting.invited')).toHaveLength(1);
    const guestMsgs = await inbox(w.guest, 'meeting.invited');
    expect(guestMsgs.some((n) => n.title.startsWith('Meeting changed'))).toBe(true);

    await request(app).put(`/api/meetings/${m._id}`).set(w.mgmt.auth).send(base(w, { minutes: 'Agreed on L-shape' })).expect(200);
  });

  it('cancelling tells the invitees', async () => {
    const w = await world();
    const m = (await request(app).post('/api/meetings').set(w.org.auth).send(base(w)).expect(201)).body;
    await request(app).patch(`/api/meetings/${m._id}/status`).set(w.org.auth).send({ status: 'cancelled' }).expect(200);
    expect(await inbox(w.guest, 'meeting.cancelled')).toHaveLength(1);
    await request(app).put(`/api/meetings/${m._id}`).set(w.org.auth).send(base(w)).expect(409);
  });
});

describe('action items', () => {
  it('owners are told, see it on their day, and can tick it off; strangers cannot', async () => {
    const w = await world();
    const m = (
      await request(app)
        .post('/api/meetings')
        .set(w.org.auth)
        .send(base(w, { actions: [{ text: 'Send revised drawing', owner: String(w.outsider.employee._id), dueDate: '2027-03-12', done: false }] }))
        .expect(201)
    ).body;
    expect(await inbox(w.outsider, 'meeting.action')).toHaveLength(1);
    // holding an action makes the meeting visible to its owner
    const detail = (await request(app).get(`/api/meetings/${m._id}`).set(w.outsider.auth).expect(200)).body;
    const day = (await request(app).get('/api/meetings/my-day').set(w.outsider.auth).expect(200)).body;
    expect(day.actions.map((a: { text: string }) => a.text)).toContain('Send revised drawing');

    const actionId = detail.actions[0]._id;
    await request(app).patch(`/api/meetings/${m._id}/actions/${actionId}`).set(w.guest.auth).send({ done: true }).expect(403);
    await request(app).patch(`/api/meetings/${m._id}/actions/${actionId}`).set(w.outsider.auth).send({ done: true }).expect(200);
    expect((await Meeting.findById(m._id).lean())!.actions[0].done).toBe(true);

    // re-saving the meeting keeps the action (same id) and does not notify the owner again
    const again = (await request(app).get(`/api/meetings/${m._id}`).set(w.org.auth)).body;
    await request(app)
      .put(`/api/meetings/${m._id}`)
      .set(w.org.auth)
      .send(base(w, { actions: again.actions.map((a: any) => ({ _id: a._id, text: a.text, owner: a.owner._id, dueDate: a.dueDate, done: a.done })) }))
      .expect(200);
    expect(await inbox(w.outsider, 'meeting.action')).toHaveLength(1);
  });
});

describe('reminders', () => {
  it('go out once, shortly before the start', async () => {
    const w = await world();
    const m = (await request(app).post('/api/meetings').set(w.org.auth).send(base(w, { date: '2027-05-04', start: '10:00', end: '10:30' })).expect(201)).body;
    setClock(() => new Date('2027-05-04T04:00:00.000Z')); // 09:30 IST: too early
    await notifyMeetingReminders();
    expect(await inbox(w.guest, 'meeting.reminder')).toHaveLength(0);
    setClock(() => new Date('2027-05-04T04:20:00.000Z')); // 09:50 IST: within 15 minutes
    await Promise.all([notifyMeetingReminders(), notifyMeetingReminders()]);
    expect(await inbox(w.guest, 'meeting.reminder')).toHaveLength(1);
    expect(await inbox(w.org, 'meeting.reminder')).toHaveLength(1);
    expect((await Meeting.findById(m._id).lean())!.reminderSentAt).toBeTruthy();
  });

  it("today's meetings appear on my day", async () => {
    const w = await world();
    await request(app).post('/api/meetings').set(w.org.auth).send(base(w, { date: todayStr(), title: 'Stand-up' })).expect(201);
    const day = (await request(app).get('/api/meetings/my-day').set(w.guest.auth).expect(200)).body;
    expect(day.today.map((m: { title: string }) => m.title)).toContain('Stand-up');
  });
});
