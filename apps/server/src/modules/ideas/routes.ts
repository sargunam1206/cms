import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { IDEA_STATUS, PERMISSIONS, ideaCommentSchema, ideaSchema, ideaStatusSchema, objectId } from '@cms/shared';
import { hasPermission, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { escapeRegex } from '../../utils/regex';
import { now } from '../../utils/time';
import { audit } from '../audit/model';
import { employeeName, notify, usersOfEmployees } from '../notifications/service';
import { Project } from '../projects/model';
import { Idea } from './model';

export const ideasRouter = Router();
const P = PERMISSIONS;
const self = requirePermission(P.IDEAS_SELF, P.IDEAS_MANAGE);
const idParam = validate(z.object({ id: objectId }), 'params');
const AUTHOR = 'name code';
const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

/** What the list and detail show: counts and "did I vote", never the list of voters. */
function present(req: Request, i: any, full = false) {
  const me = req.user?.employeeId;
  const { voters, comments, history, ...rest } = i;
  return {
    ...rest,
    voted: (voters ?? []).some((v: unknown) => same(v, me)),
    mine: same(i.author?._id ?? i.author, me),
    commentCount: (comments ?? []).length,
    ...(full ? { comments, history } : {}),
  };
}
const canManage = (req: Request) => hasPermission(req, P.IDEAS_MANAGE);

async function load(id: string) {
  const i = await Idea.findById(id);
  if (!i) throw notFound('Idea');
  return i;
}

const listQuery = z.object({
  status: z.enum(IDEA_STATUS).optional(),
  tag: z.string().max(30).optional(),
  q: z.string().max(100).optional(),
  mine: z.enum(['true']).optional(),
  sort: z.enum(['votes', 'new']).default('votes'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

ideasRouter.get(
  '/',
  self,
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const { status, tag, q, mine, sort, page, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (tag) filter.tags = tag;
    if (mine) filter.author = req.user!.employeeId;
    if (q) filter.$or = [{ title: new RegExp(escapeRegex(q), 'i') }, { description: new RegExp(escapeRegex(q), 'i') }];
    const order: Record<string, 1 | -1> = sort === 'new' ? { createdAt: -1 } : { votes: -1, createdAt: -1 };
    const [items, total, tags] = await Promise.all([
      Idea.find(filter).select('-history').populate('author', AUTHOR).populate('project', 'code name').sort(order).skip((page - 1) * limit).limit(limit).lean(),
      Idea.countDocuments(filter),
      Idea.distinct('tags'),
    ]);
    res.json({ items: items.map((i) => present(req, i)), total, page, limit, tags: tags.sort() });
  }),
);

ideasRouter.post(
  '/',
  self,
  validate(ideaSchema),
  ah(async (req, res) => {
    const me = requireEmployee(req);
    const b = req.body as z.infer<typeof ideaSchema>;
    const tags = [...new Set(b.tags.map((t) => t.toLowerCase()))];
    const i = await Idea.create({ title: b.title, description: b.description, tags, author: me, history: [{ at: now(), byName: await employeeName(me), to: 'submitted' }] });
    await audit({ actor: req.user!.id, action: 'idea.create', entity: 'Idea', entityId: i._id, meta: { title: i.title } });
    res.status(201).json(present(req, i.toObject()));
  }),
);

ideasRouter.get(
  '/:id',
  self,
  idParam,
  ah(async (req, res) => {
    await load(req.params.id);
    const i = await Idea.findById(req.params.id).populate('author', AUTHOR).populate('project', 'code name').lean();
    res.json({ ...present(req, i, true), canManage: canManage(req), canEdit: same((i!.author as any)?._id, req.user!.employeeId) && i!.status === 'submitted' });
  }),
);

/** The author can reword an idea until someone starts reviewing it. */
ideasRouter.put(
  '/:id',
  self,
  idParam,
  validate(ideaSchema),
  ah(async (req, res) => {
    const i = await load(req.params.id);
    if (!same(i.author, req.user!.employeeId)) throw forbidden('Only the author can edit an idea');
    if (i.status !== 'submitted') throw conflict('The idea is already being reviewed and can no longer be edited');
    const b = req.body as z.infer<typeof ideaSchema>;
    i.set({ title: b.title, description: b.description, tags: [...new Set(b.tags.map((t) => t.toLowerCase()))] });
    await i.save();
    res.json(present(req, i.toObject()));
  }),
);

ideasRouter.delete(
  '/:id',
  self,
  idParam,
  ah(async (req, res) => {
    const i = await load(req.params.id);
    const mineToDrop = same(i.author, req.user!.employeeId) && i.status === 'submitted' && i.votes === 0;
    if (!mineToDrop && !canManage(req)) throw forbidden('You can only remove your own idea before anyone has voted or reviewed it');
    await i.deleteOne();
    await audit({ actor: req.user!.id, action: 'idea.delete', entity: 'Idea', entityId: i._id, meta: { title: i.title } });
    res.json({ ok: true });
  }),
);

/** Set whether I vote for an idea. Saying the same thing twice changes nothing. Not on your own idea. */
ideasRouter.put(
  '/:id/vote',
  self,
  idParam,
  validate(z.object({ voted: z.boolean() })),
  ah(async (req, res) => {
    const me = requireEmployee(req);
    // only what the checks need: loading the comments and every voter on each click would be wasteful
    const i = await Idea.findById(req.params.id).select('author status').lean();
    if (!i) throw notFound('Idea');
    if (same(i.author, me)) throw badRequest('You cannot vote for your own idea');
    if (i.status === 'declined' || i.status === 'done') throw conflict(`Voting is closed: the idea is ${i.status}`);
    const updated = req.body.voted
      ? await Idea.findOneAndUpdate({ _id: i._id, voters: { $ne: me } }, { $addToSet: { voters: me }, $inc: { votes: 1 } }, { new: true })
      : await Idea.findOneAndUpdate({ _id: i._id, voters: me }, { $pull: { voters: me }, $inc: { votes: -1 } }, { new: true });
    const cur = updated ?? (await Idea.findById(i._id).select('votes voters'))!; // no change: already in that state
    res.json({ voted: cur.voters.some((v) => same(v, me)), votes: cur.votes });
  }),
);

ideasRouter.post(
  '/:id/comments',
  self,
  idParam,
  validate(ideaCommentSchema),
  ah(async (req, res) => {
    const me = requireEmployee(req);
    const i = await load(req.params.id);
    const { text, parent } = req.body as z.infer<typeof ideaCommentSchema>;
    if (parent) {
      const p = i.comments.find((c) => same(c._id, parent));
      if (!p) throw badRequest('That comment does not exist');
      if (p.replyTo) throw badRequest('Replies go one level deep: reply to the original comment');
    }
    const updated = await Idea.findByIdAndUpdate(i._id, { $push: { comments: { by: me, byName: await employeeName(me), text, replyTo: parent ?? null, at: now() } } }, { new: true }).select('comments'); // atomic: a popular idea gets simultaneous comments
    await notify({ type: 'idea.comment', to: await usersOfEmployees([i.author]), actor: req.user!.id, title: `${await employeeName(me)} commented on your idea`, body: text.slice(0, 140), link: `/ideas/${i._id}`, entity: { kind: 'Idea', id: i._id } });
    res.status(201).json(updated!.comments.at(-1));
  }),
);

ideasRouter.post(
  '/:id/status',
  requirePermission(P.IDEAS_MANAGE),
  idParam,
  validate(ideaStatusSchema),
  ah(async (req, res) => {
    const i = await load(req.params.id);
    const { status, comment, project } = req.body as z.infer<typeof ideaStatusSchema>;
    if (status === i.status && project === undefined) throw badRequest(`It is already ${status}`);
    if (status === 'declined' && !comment) throw badRequest('Say why the idea is declined');
    if (project && !(await Project.exists({ _id: project }))) throw badRequest('Project not found');
    const from = i.status;
    const set: Record<string, unknown> = { status };
    if (project !== undefined) set.project = project || null;
    const entry = status !== from ? { at: now(), byName: await employeeName(req.user!.employeeId), from, to: status, comment: comment || undefined } : null;
    const saved = await Idea.findByIdAndUpdate(i._id, { $set: set, ...(entry ? { $push: { history: entry } } : {}) }, { new: true });
    await audit({ actor: req.user!.id, action: 'idea.status', entity: 'Idea', entityId: i._id, meta: { from, to: status, comment } });
    if (status !== from)
      await notify({ type: 'idea.status', to: await usersOfEmployees([i.author]), actor: req.user!.id, title: `Your idea "${i.title}" is now ${status.replace('_', ' ')}`, body: comment, link: `/ideas/${i._id}`, entity: { kind: 'Idea', id: i._id } });
    res.json(present(req, saved!.toObject()));
  }),
);
