import { Router } from 'express';
import { Types } from 'mongoose';
import type { Request } from 'express';
import { z } from 'zod';
import { MEETING_STATUS, MEETING_TYPES, PERMISSIONS, meetingSchema, objectId, type MeetingInput } from '@cms/shared';
import { hasPermission, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { escapeRegex } from '../../utils/regex';
import { now, todayStr, zonedDateTime } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee } from '../employees/model';
import { notify, usersOfEmployees } from '../notifications/service';
import { Client, Project } from '../projects/model';
import { seesAll } from '../projects/access';
import { Meeting } from './model';
import { typeText, whenText } from './service';

export const meetingsRouter = Router();
const P = PERMISSIONS;
const self = requirePermission(P.MEETINGS_SELF, P.MEETINGS_MANAGE);
const idParam = validate(z.object({ id: objectId }), 'params');
const PERSON = 'name code department designation';
const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);
const managesAll = (req: Request) => hasPermission(req, P.MEETINGS_MANAGE);
const idOf = (v: any) => String(v?._id ?? v);

/** People see meetings they organise, attend or hold an action in; meetings.manage sees all of them. */
const canSeeMeeting = (req: Request, m: any) => {
  if (managesAll(req)) return true;
  const me = req.user!.employeeId;
  return same(idOf(m.organizer), me) || (m.attendees ?? []).some((a: any) => same(idOf(a), me)) || (m.actions ?? []).some((a: any) => same(idOf(a.owner), me));
};
const canEditMeeting = (req: Request, m: any) => managesAll(req) || same(idOf(m.organizer), req.user!.employeeId);

async function load(req: Request, id: string) {
  const m = await Meeting.findById(id);
  if (!m || !canSeeMeeting(req, m)) throw notFound('Meeting');
  return m;
}

/** A link to a project or client is only accepted if the caller may see that record. */
async function checkLinks(req: Request, b: MeetingInput) {
  const project = b.project || null;
  const client = b.client || null;
  if (project) {
    const p = await Project.findById(project).select('manager members').lean();
    const me = req.user!.employeeId;
    if (!p || (!seesAll(req) && !same(p.manager, me) && !p.members.some((x) => same(x, me)))) throw forbidden('You cannot link that project');
  }
  if (client && !(hasPermission(req, P.PROJECTS_VIEW) || hasPermission(req, P.PROJECTS_MANAGE))) throw forbidden('You cannot link clients');
  if (client && !(await Client.exists({ _id: client }))) throw notFound('Client');
  return { project, client };
}

function fields(b: MeetingInput, prevActions: any[] = []) {
  const prev = new Map(prevActions.map((a) => [String(a._id), a]));
  return {
    title: b.title,
    type: b.type,
    date: b.date,
    start: b.start,
    end: b.end,
    startAt: zonedDateTime(b.date, b.start),
    location: b.location || '',
    link: b.link || '',
    attendees: [...new Set(b.attendees)],
    guests: b.guests || '',
    agenda: b.agenda || '',
    minutes: b.minutes || '',
    actions: b.actions.map((a) => {
      const old = a._id ? prev.get(a._id) : null;
      return {
        ...(a._id && old ? { _id: a._id } : {}),
        text: a.text,
        owner: a.owner || null,
        dueDate: a.dueDate || null,
        done: a.done,
        doneAt: a.done ? (old?.doneAt ?? now()) : undefined,
      };
    }),
  };
}

async function tellActionOwners(req: Request, m: any, before: any[] = []) {
  const had = new Set(before.filter((a) => a.owner).map((a) => `${a._id}:${a.owner}`));
  const fresh = m.actions.filter((a: any) => a.owner && !a.done && !had.has(`${a._id}:${a.owner}`));
  for (const a of fresh) {
    await notify({
      type: 'meeting.action',
      to: await usersOfEmployees([a.owner]),
      actor: req.user!.id,
      title: `Action for you from "${m.title}"`,
      body: `${a.text}${a.dueDate ? ` (due ${a.dueDate})` : ''}`,
      link: `/meetings/${m._id}`,
      entity: { kind: 'Meeting', id: m._id },
    });
  }
}

const listQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  scope: z.enum(['mine', 'all']).optional(),
  type: z.enum(MEETING_TYPES).optional(),
  status: z.enum(MEETING_STATUS).optional(),
  project: objectId.optional(),
  client: objectId.optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  order: z.enum(['asc', 'desc']).default('asc'),
});

meetingsRouter.get(
  '/',
  self,
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const f = req.query as unknown as z.infer<typeof listQuery>;
    const me = req.user!.employeeId;
    const filter: Record<string, unknown> =
      f.scope === 'mine' || !managesAll(req) ? { $or: [{ organizer: me }, { attendees: me }, { 'actions.owner': me }] } : {};
    if (f.from || f.to) filter.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
    if (f.type) filter.type = f.type;
    if (f.status) filter.status = f.status;
    if (f.project) filter.project = f.project;
    if (f.client) filter.client = f.client;
    if (f.q) {
      const rx = new RegExp(escapeRegex(f.q), 'i');
      filter.$and = [{ $or: [{ title: rx }, { location: rx }, { guests: rx }, { agenda: rx }] }];
    }
    const dir = f.order === 'desc' ? -1 : 1;
    const [items, total] = await Promise.all([
      Meeting.find(filter)
        .select('-minutes -agenda')
        .populate('organizer', 'name code')
        .populate('project', 'code name')
        .populate('client', 'name')
        .sort({ startAt: dir })
        .skip((f.page - 1) * f.limit)
        .limit(f.limit)
        .lean(),
      Meeting.countDocuments(filter),
    ]);
    res.json({
      items: items.map((m) => ({ ...m, attendeeCount: m.attendees.length, openActions: m.actions.filter((a) => !a.done).length, actions: undefined })),
      total,
      page: f.page,
      limit: f.limit,
      seesAll: managesAll(req),
    });
  }),
);

/** Choices for the meeting form: people to invite, and the projects and clients the caller may link. */
meetingsRouter.get(
  '/options',
  self,
  ah(async (req, res) => {
    const me = req.user!.employeeId;
    const canClients = hasPermission(req, P.PROJECTS_VIEW) || hasPermission(req, P.PROJECTS_MANAGE);
    const projectFilter = seesAll(req) ? {} : { $or: [{ manager: me }, { members: me }] };
    const [people, projects, clients] = await Promise.all([
      Employee.find({ status: 'active' }).select(PERSON).sort({ name: 1 }).lean(),
      Project.find({ ...projectFilter, status: { $nin: ['cancelled'] } }).select('code name client').sort({ code: 1 }).lean(),
      canClients ? Client.find({ active: { $ne: false } }).select('name').sort({ name: 1 }).lean() : Promise.resolve([]),
    ]);
    res.json({ people, projects, clients, canLinkClients: canClients });
  }),
);

/** Today's meetings for the dashboard, and the open action items assigned to the caller. */
meetingsRouter.get(
  '/my-day',
  self,
  ah(async (req, res) => {
    const me = req.user!.employeeId;
    const mine = { $or: [{ organizer: me }, { attendees: me }] };
    const meId = me ? new Types.ObjectId(String(me)) : null; // aggregate does not cast strings to ids
    const [today, actions] = await Promise.all([
      Meeting.find({ ...mine, date: todayStr(), status: { $ne: 'cancelled' } }).select('title type date start end location link status').sort({ startAt: 1 }).lean(),
      meId
        ? Meeting.aggregate([
            { $match: { 'actions.owner': meId, status: { $ne: 'cancelled' } } },
            { $unwind: '$actions' },
            { $match: { 'actions.owner': meId, 'actions.done': false } },
            { $sort: { 'actions.dueDate': 1 } },
            { $limit: 20 },
            { $project: { meetingId: '$_id', meeting: '$title', date: 1, _id: '$actions._id', text: '$actions.text', dueDate: '$actions.dueDate' } },
          ])
        : Promise.resolve([]),
    ]);
    res.json({ today, actions });
  }),
);

meetingsRouter.post(
  '/',
  self,
  validate(meetingSchema),
  ah(async (req, res) => {
    const me = requireEmployee(req);
    const b = req.body as MeetingInput;
    const links = await checkLinks(req, b);
    const m = await Meeting.create({ ...fields(b), ...links, organizer: me, createdBy: req.user!.id });
    await audit({ actor: req.user!.id, action: 'meeting.create', entity: 'Meeting', entityId: m._id, meta: { title: m.title, date: m.date } });
    await notify({
      type: 'meeting.invited',
      to: await usersOfEmployees(m.attendees),
      actor: req.user!.id,
      title: `Meeting: ${m.title}`,
      body: `${typeText(m.type)} · ${whenText(m)}${m.location ? ` · ${m.location}` : ''}`,
      link: `/meetings/${m._id}`,
      entity: { kind: 'Meeting', id: m._id },
    });
    await tellActionOwners(req, m);
    res.status(201).json(m);
  }),
);

meetingsRouter.get(
  '/:id',
  self,
  idParam,
  ah(async (req, res) => {
    await load(req, req.params.id);
    const m = await Meeting.findById(req.params.id)
      .populate('organizer', PERSON)
      .populate('attendees', PERSON)
      .populate('actions.owner', 'name code')
      .populate('project', 'code name')
      .populate('client', 'name')
      .lean();
    const me = req.user!.employeeId;
    res.json({ ...m, canEdit: canEditMeeting(req, m), isOrganizer: same((m!.organizer as any)?._id, me) });
  }),
);

meetingsRouter.put(
  '/:id',
  self,
  idParam,
  validate(meetingSchema),
  ah(async (req, res) => {
    const m = await load(req, req.params.id);
    if (!canEditMeeting(req, m)) throw forbidden('Only the organiser can change this meeting');
    if (m.status === 'cancelled') throw conflict('This meeting was cancelled');
    const b = req.body as MeetingInput;
    const links = await checkLinks(req, b);
    const before = m.toObject();
    const next = fields(b, before.actions);
    const timeChanged = before.date !== next.date || before.start !== next.start || before.end !== next.end || (before.location ?? '') !== next.location || (before.link ?? '') !== next.link;
    m.set({ ...next, ...links, ...(before.startAt.getTime() !== next.startAt.getTime() ? { reminderSentAt: null } : {}) });
    await m.save();
    await audit({ actor: req.user!.id, action: 'meeting.update', entity: 'Meeting', entityId: m._id, meta: { title: m.title } });

    const oldIds = new Set(before.attendees.map(String));
    const added = m.attendees.filter((a) => !oldIds.has(String(a)));
    const kept = m.attendees.filter((a) => oldIds.has(String(a)));
    const body = `${typeText(m.type)} · ${whenText(m)}${m.location ? ` · ${m.location}` : ''}`;
    await notify({ type: 'meeting.invited', to: await usersOfEmployees(added), actor: req.user!.id, title: `Meeting: ${m.title}`, body, link: `/meetings/${m._id}`, entity: { kind: 'Meeting', id: m._id } });
    if (timeChanged) {
      await notify({ type: 'meeting.invited', to: await usersOfEmployees(kept), actor: req.user!.id, title: `Meeting changed: ${m.title}`, body: `Now ${body}`, link: `/meetings/${m._id}`, entity: { kind: 'Meeting', id: m._id } });
    }
    await tellActionOwners(req, m, before.actions);
    res.json(m);
  }),
);

/** Mark a meeting held or cancelled (or back to scheduled). Cancelling tells everyone invited. */
meetingsRouter.patch(
  '/:id/status',
  self,
  idParam,
  validate(z.object({ status: z.enum(MEETING_STATUS) })),
  ah(async (req, res) => {
    const m = await load(req, req.params.id);
    if (!canEditMeeting(req, m)) throw forbidden('Only the organiser can change this meeting');
    const from = m.status;
    m.status = req.body.status;
    await m.save();
    await audit({ actor: req.user!.id, action: 'meeting.status', entity: 'Meeting', entityId: m._id, meta: { from, to: m.status } });
    if (m.status === 'cancelled' && from !== 'cancelled') {
      await notify({ type: 'meeting.cancelled', to: await usersOfEmployees(m.attendees), actor: req.user!.id, title: `Cancelled: ${m.title}`, body: whenText(m), link: `/meetings/${m._id}`, entity: { kind: 'Meeting', id: m._id } });
    }
    res.json(m);
  }),
);

/** Tick an action item done (or not). The owner, the organiser or meetings.manage may do this. */
meetingsRouter.patch(
  '/:id/actions/:actionId',
  self,
  validate(z.object({ id: objectId, actionId: objectId }), 'params'),
  validate(z.object({ done: z.boolean() })),
  ah(async (req, res) => {
    const m = await load(req, req.params.id);
    const a = m.actions.id(req.params.actionId);
    if (!a) throw notFound('Action item');
    if (!canEditMeeting(req, m) && !same(a.owner, req.user!.employeeId)) throw forbidden('Only the action owner or the organiser can update it');
    const r = await Meeting.updateOne(
      { _id: m._id, 'actions._id': a._id },
      { $set: { 'actions.$.done': req.body.done, 'actions.$.doneAt': req.body.done ? now() : null } },
    );
    if (!r.matchedCount) throw notFound('Action item');
    res.json({ ok: true });
  }),
);

meetingsRouter.delete(
  '/:id',
  self,
  idParam,
  ah(async (req, res) => {
    const m = await load(req, req.params.id);
    if (!canEditMeeting(req, m)) throw forbidden('Only the organiser can delete this meeting');
    await Meeting.deleteOne({ _id: m._id });
    await audit({ actor: req.user!.id, action: 'meeting.delete', entity: 'Meeting', entityId: m._id, before: { title: m.title, date: m.date } });
    res.json({ ok: true });
  }),
);
