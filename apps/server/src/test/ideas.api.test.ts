import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Notification } from '../modules/notifications/model';
import { User } from '../modules/users/model';
import { app, connectTestDb, createPerson, dropTestDb, seedRoles } from './helpers';

let roles: Awaited<ReturnType<typeof seedRoles>>;
beforeAll(async () => {
  await connectTestDb();
  roles = await seedRoles();
});
afterAll(dropTestDb);

type Person = Awaited<ReturnType<typeof createPerson>>;
const userOf = async (p: Person) => (await User.findOne({ employee: p.employee._id }))!._id;

async function world() {
  return { author: await createPerson(roles.Employee), voter: await createPerson(roles.Employee), voter2: await createPerson(roles.Employee), mgmt: await createPerson(roles.Management) };
}
type W = Awaited<ReturnType<typeof world>>;
const post = (w: W, body: object = {}) => request(app).post('/api/ideas').set(w.author.auth).send({ title: 'Solar panels on the roof', description: 'Cut the power bill with a rooftop array.', tags: ['Energy', 'energy', 'cost'], ...body });

describe('submitting', () => {
  it('anyone can; tags are tidied; validation applies', async () => {
    const w = await world();
    const i = (await post(w).expect(201)).body;
    expect(i.status).toBe('submitted');
    expect(i.tags).toEqual(['energy', 'cost']);
    expect(i.votes).toBe(0);
    expect(i.mine).toBe(true);
    await post(w, { title: 'No' }).expect(400);
    await post(w, { description: 'short' }).expect(400);
    await request(app).get('/api/ideas').expect(401);
  });

  it('the author can reword it until review starts, and withdraw it while nobody has voted', async () => {
    const w = await world();
    const i = (await post(w).expect(201)).body;
    await request(app).put(`/api/ideas/${i._id}`).set(w.voter.auth).send({ title: 'Hijacked title', description: 'Not the author at all.', tags: [] }).expect(403);
    const e = (await request(app).put(`/api/ideas/${i._id}`).set(w.author.auth).send({ title: 'Solar panels, phase one', description: 'Start with the east wing roof only.', tags: [] }).expect(200)).body;
    expect(e.title).toBe('Solar panels, phase one');

    await request(app).put(`/api/ideas/${i._id}/vote`).set(w.voter.auth).send({ voted: true }).expect(200);
    await request(app).delete(`/api/ideas/${i._id}`).set(w.author.auth).expect(403); // already has a vote
    await request(app).post(`/api/ideas/${i._id}/status`).set(w.mgmt.auth).send({ status: 'under_review' }).expect(200);
    await request(app).put(`/api/ideas/${i._id}`).set(w.author.auth).send({ title: 'Too late to edit', description: 'It is under review now.', tags: [] }).expect(409);
    await request(app).delete(`/api/ideas/${i._id}`).set(w.mgmt.auth).expect(200); // managers can still remove
    const lone = (await post(w, { title: 'Withdrawn idea' }).expect(201)).body;
    await request(app).delete(`/api/ideas/${lone._id}`).set(w.author.auth).expect(200);
  });
});

describe('voting', () => {
  it('one vote each, removable, never your own, idempotent, and counted exactly', async () => {
    const w = await world();
    const i = (await post(w).expect(201)).body;
    const vote = (who: Person, voted: boolean) => request(app).put(`/api/ideas/${i._id}/vote`).set(who.auth).send({ voted });
    await vote(w.author, true).expect(400);
    expect((await vote(w.voter, true).expect(200)).body).toEqual({ voted: true, votes: 1 });
    expect((await vote(w.voter, true).expect(200)).body).toEqual({ voted: true, votes: 1 }); // again: no double count
    expect((await vote(w.voter2, true).expect(200)).body).toEqual({ voted: true, votes: 2 });
    expect((await vote(w.voter, false).expect(200)).body).toEqual({ voted: false, votes: 1 });
    expect((await vote(w.voter, false).expect(200)).body).toEqual({ voted: false, votes: 1 }); // removing twice is harmless

    // many people voting at once still add up
    const crowd: Person[] = [];
    for (let k = 0; k < 6; k++) crowd.push(await createPerson(roles.Employee)); // created one by one; the voting below is concurrent
    await Promise.all(crowd.map((p) => vote(p, true).expect(200)));
    await Promise.all(crowd.map((p) => vote(p, true).expect(200)));
    const d = (await request(app).get(`/api/ideas/${i._id}`).set(w.voter2.auth).expect(200)).body;
    expect(d.votes).toBe(7);
    expect(d.voted).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/voters/); // who voted is not exposed
    expect((await request(app).get(`/api/ideas/${i._id}`).set(w.voter.auth).expect(200)).body.voted).toBe(false);
  });

  it('closes once an idea is done or declined', async () => {
    const w = await world();
    const i = (await post(w).expect(201)).body;
    await request(app).post(`/api/ideas/${i._id}/status`).set(w.mgmt.auth).send({ status: 'declined', comment: 'Not feasible for a rented building' }).expect(200);
    await request(app).put(`/api/ideas/${i._id}/vote`).set(w.voter.auth).send({ voted: true }).expect(409);
  });
});

describe('comments', () => {
  it('threads one level deep and tells the author', async () => {
    const w = await world();
    const i = (await post(w).expect(201)).body;
    const c = (await request(app).post(`/api/ideas/${i._id}/comments`).set(w.voter.auth).send({ text: 'Great idea, what would it cost?' }).expect(201)).body;
    const r = (await request(app).post(`/api/ideas/${i._id}/comments`).set(w.author.auth).send({ text: 'About 4 lakh for the east wing', parent: c._id }).expect(201)).body;
    expect(r.replyTo).toBe(c._id);
    await request(app).post(`/api/ideas/${i._id}/comments`).set(w.voter2.auth).send({ text: 'Replying to a reply', parent: r._id }).expect(400);
    await request(app).post(`/api/ideas/${i._id}/comments`).set(w.voter2.auth).send({ text: 'Bad parent', parent: '5f0000000000000000000000' }).expect(400);
    const d = (await request(app).get(`/api/ideas/${i._id}`).set(w.voter.auth).expect(200)).body;
    expect(d.comments).toHaveLength(2);
    expect(d.commentCount).toBe(2);
    // the author heard about the voter's comment, but not about their own reply
    const n = await Notification.find({ user: await userOf(w.author), type: 'idea.comment' }).lean();
    expect(n).toHaveLength(1);
    expect(n[0].title).toMatch(/commented on your idea/);
  });
});

describe('the pipeline', () => {
  it('only managers move ideas; declining needs a reason; the author is told; history is kept', async () => {
    const w = await world();
    const i = (await post(w).expect(201)).body;
    await request(app).post(`/api/ideas/${i._id}/status`).set(w.voter.auth).send({ status: 'approved' }).expect(403);
    await request(app).post(`/api/ideas/${i._id}/status`).set(w.author.auth).send({ status: 'approved' }).expect(403);
    await request(app).post(`/api/ideas/${i._id}/status`).set(w.mgmt.auth).send({ status: 'declined' }).expect(400);
    await request(app).post(`/api/ideas/${i._id}/status`).set(w.mgmt.auth).send({ status: 'submitted' }).expect(400); // no change
    await request(app).post(`/api/ideas/${i._id}/status`).set(w.mgmt.auth).send({ status: 'under_review' }).expect(200);
    await request(app).post(`/api/ideas/${i._id}/status`).set(w.mgmt.auth).send({ status: 'approved', comment: 'Budget agreed' }).expect(200);
    const d = (await request(app).get(`/api/ideas/${i._id}`).set(w.mgmt.auth).expect(200)).body;
    expect(d.status).toBe('approved');
    expect(d.history.map((h: any) => h.to)).toEqual(['submitted', 'under_review', 'approved']);
    expect(d.canManage).toBe(true);
    const n = await Notification.find({ user: await userOf(w.author), type: 'idea.status' }).sort({ createdAt: 1 }).lean();
    expect(n.map((x) => x.title)).toEqual(expect.arrayContaining([expect.stringMatching(/is now under review/), expect.stringMatching(/is now approved/)]));
    expect((await request(app).get(`/api/ideas/${i._id}`).set(w.voter.auth).expect(200)).body.canManage).toBe(false);
  });

  it('lists by votes or newest, filters by status, tag, text and mine', async () => {
    const w = await world();
    const a = (await post(w, { title: 'Quiet room for calls', tags: ['office'] }).expect(201)).body;
    const b = (await post(w, { title: 'Free fruit on Fridays', tags: ['culture'] }).expect(201)).body;
    await request(app).put(`/api/ideas/${b._id}/vote`).set(w.voter.auth).send({ voted: true }).expect(200);
    const list = async (q: object, who: Person = w.voter) => (await request(app).get('/api/ideas').query({ limit: 100, ...q }).set(who.auth).expect(200)).body;
    const byVotes = (await list({ sort: 'votes' })).items.map((x: any) => x._id);
    expect(byVotes.indexOf(b._id)).toBeLessThan(byVotes.indexOf(a._id));
    const byNew = (await list({ sort: 'new' })).items.map((x: any) => x._id);
    expect(byNew.indexOf(b._id)).toBeLessThan(byNew.indexOf(a._id));
    expect((await list({ q: 'fruit' })).items.map((x: any) => x._id)).toEqual([b._id]);
    expect((await list({ tag: 'office' })).items.map((x: any) => x._id)).toEqual([a._id]);
    expect((await list({ status: 'submitted', mine: 'true' }, w.author)).items.length).toBeGreaterThanOrEqual(2);
    expect((await list({ mine: 'true' }, w.voter)).items.every((x: any) => x.mine)).toBe(true);
    expect((await list({})).tags).toEqual(expect.arrayContaining(['office', 'culture']));
    const row = (await list({ q: 'fruit' })).items[0];
    expect(row.voted).toBe(true);
    expect(row.comments).toBeUndefined();
  });
});

describe('simultaneous comments', () => {
  it('a popular idea takes many comments at once without losing or failing any', async () => {
    const w = await world();
    const i = (await post(w).expect(201)).body;
    const who = [w.author, w.voter, w.voter2, w.mgmt];
    const results = await Promise.all(Array.from({ length: 12 }, (_, k) => request(app).post(`/api/ideas/${i._id}/comments`).set(who[k % who.length].auth).send({ text: `Comment ${k}` })));
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
    const status = await Promise.all([request(app).post(`/api/ideas/${i._id}/status`).set(w.mgmt.auth).send({ status: 'under_review' }), request(app).post(`/api/ideas/${i._id}/comments`).set(w.voter.auth).send({ text: 'During the move' })]);
    expect(status.map((r) => r.status)).toEqual([200, 201]);
    const d = (await request(app).get(`/api/ideas/${i._id}`).set(w.voter.auth).expect(200)).body;
    expect(d.comments).toHaveLength(13);
    expect(d.status).toBe('under_review');
  });
});
