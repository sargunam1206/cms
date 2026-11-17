import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { LOST, PERMISSIONS, WON, enquiryConvertSchema, enquiryNoteSchema, enquiryOptionsSchema, enquirySchema, enquiryStatusSchema, enquiryUpdateSchema, objectId, phoneKey } from '@cms/shared';
import { hasPermission, requireEmployee, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { escapeRegex } from '../../utils/regex';
import { now, todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee, teamIds } from '../employees/model';
import { employeeName } from '../notifications/service';
import { Client, Project } from '../projects/model';
import { setSetting } from '../settings/service';
import { Enquiry } from './model';
import { OPTIONS_KEY, allStatuses, getOptions, isClosed } from './service';

export const enquiriesRouter = Router();
const P = PERMISSIONS;
const anyRight = requirePermission(P.ENQUIRIES_SELF, P.ENQUIRIES_VIEW, P.ENQUIRIES_MANAGE);
const idParam = validate(z.object({ id: objectId }), 'params');
const OWNER = 'name code';

/** People who see every enquiry: Management, HR (read-only), Admin. */
const seesAll = (req: Request) => hasPermission(req, P.ENQUIRIES_VIEW) || hasPermission(req, P.ENQUIRIES_MANAGE);
/**
 * Whose enquiries the caller may see: everyone's, or their own plus those of the people who report to them.
 * Seeing is not changing: a manager can follow the team's enquiries but only the owner (or an enquiry manager) edits them.
 */
async function scope(req: Request): Promise<Record<string, unknown>> {
  if (seesAll(req)) return {};
  const me = req.user!.employeeId;
  if (!me) return { owner: null };
  const team = await teamIds(me);
  return { owner: team.length ? { $in: [me, ...team] } : me };
}
const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

/** Change enquiries: manage, or own it with enquiries.self. HR (view only) cannot. */
const canWrite = (req: Request, e: { owner: unknown }) => hasPermission(req, P.ENQUIRIES_MANAGE) || (hasPermission(req, P.ENQUIRIES_SELF) && same(e.owner, req.user!.employeeId));

async function loadFor(req: Request, id: string) {
  const e = await Enquiry.findOne({ _id: id, ...(await scope(req)) });
  if (!e) throw notFound('Enquiry'); // someone else's enquiry looks the same as a missing one
  return e;
}
const assertWrite = (req: Request, e: { owner: unknown }) => {
  if (!canWrite(req, e)) throw forbidden('Only the owner of this enquiry can change it');
};

/** Run a load-change-save again from scratch if someone changed the same enquiry at the same moment. */
async function retrying<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if ((err as Error).name === 'VersionError' && attempt < 4) continue;
      throw err;
    }
  }
}

async function log(req: Request, e: InstanceType<typeof Enquiry>, kind: string, text?: string) {
  e.activity.push({ at: now(), by: req.user!.id as never, byName: await employeeName(req.user!.employeeId), kind, text } as never);
}

/** Enquiries with the same phone that are not Lost. (A lost one may come back.) */
async function duplicatesOf(key: string, excludeId?: string) {
  return Enquiry.find({ phoneKey: key, status: { $ne: LOST }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })
    .select('name company status owner')
    .populate('owner', OWNER)
    .lean();
}
async function assertNoDuplicate(key: string, excludeId?: string) {
  const dup = (await duplicatesOf(key, excludeId))[0];
  if (dup) throw conflict(`This phone number already belongs to an enquiry: ${dup.name}${dup.company ? ` (${dup.company})` : ''}, ${dup.status}, owned by ${(dup.owner as unknown as { name?: string } | null)?.name ?? 'someone'}`);
}

const view = (e: any) => ({ ...e, overdue: !!e.nextFollowUp && !isClosed(e.status) && e.nextFollowUp < todayStr() });

// ===================== Dropdown values =====================
enquiriesRouter.get(
  '/options',
  anyRight,
  ah(async (req, res) => {
    const me = req.user!.employeeId;
    // viewsOthers: the screen offers an owner filter when the caller can see more than their own
    const viewsOthers = seesAll(req) || (!!me && (await teamIds(me)).length > 0);
    res.json({ ...(await getOptions()), won: WON, lost: LOST, viewsOthers });
  }),
);

enquiriesRouter.put(
  '/options',
  requirePermission(P.ENQUIRIES_MANAGE),
  validate(enquiryOptionsSchema),
  ah(async (req, res) => {
    const o = req.body as z.infer<typeof enquiryOptionsSchema>;
    for (const k of ['sources', 'stages', 'lostReasons'] as const) if (new Set(o[k].map((x) => x.toLowerCase())).size !== o[k].length) throw badRequest(`${k} contains the same value twice`);
    if (o.stages.some((s) => s === WON || s === LOST)) throw badRequest(`${WON} and ${LOST} are fixed and cannot be used as a stage`);
    // A stage that enquiries are still sitting in cannot be removed
    const used = await Enquiry.distinct('status', { status: { $nin: [WON, LOST, ...o.stages] } });
    if (used.length) throw conflict(`Enquiries are still in: ${used.join(', ')}. Move them first or keep the stage.`);
    await setSetting(OPTIONS_KEY, o, '1970-01-01', req.user!.id as never);
    res.json(o);
  }),
);

// ===================== Duplicate check, summary =====================
enquiriesRouter.get(
  '/check',
  anyRight,
  validate(z.object({ phone: z.string().max(30), exclude: objectId.optional() }), 'query'),
  ah(async (req, res) => {
    const { phone, exclude } = req.query as { phone: string; exclude?: string };
    const key = phoneKey(phone);
    if (!key) return res.json({ matches: [] });
    const found = await duplicatesOf(key, exclude);
    // Everyone is told a duplicate exists (to avoid double work); only people who may open it get the link
    const openable = new Set((await Enquiry.find({ _id: { $in: found.map((d) => d._id) }, ...(await scope(req)) }).select('_id').lean()).map((x) => String(x._id)));
    res.json({ matches: found.map((d) => ({ _id: openable.has(String(d._id)) ? d._id : undefined, name: d.name, company: d.company, status: d.status, owner: (d.owner as unknown as { name?: string } | null)?.name })) });
  }),
);
enquiriesRouter.get(
  '/summary',
  anyRight,
  ah(async (req, res) => {
    const today = todayStr();
    const sc = await scope(req);
    const [byStatus, due] = await Promise.all([
      Enquiry.aggregate([{ $match: sc }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Enquiry.aggregate([
        { $match: { ...sc, status: { $nin: [WON, LOST] }, nextFollowUp: { $lte: today } } },
        { $group: { _id: { $cond: [{ $lt: ['$nextFollowUp', today] }, 'overdue', 'today'] }, n: { $sum: 1 } } },
      ]),
    ]);
    const o = await getOptions();
    const counts = Object.fromEntries(allStatuses(o).map((s) => [s, 0]));
    for (const r of byStatus) counts[r._id] = (counts[r._id] ?? 0) + r.n;
    const n = (k: string) => due.find((d) => d._id === k)?.n ?? 0;
    const won = counts[WON] ?? 0;
    const lost = counts[LOST] ?? 0;
    res.json({
      byStatus: counts,
      open: o.stages.reduce((s, st) => s + (counts[st] ?? 0), 0),
      dueToday: n('today'),
      overdue: n('overdue'),
      won,
      lost,
      conversionRate: won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : null,
    });
  }),
);

// ===================== List and create =====================
const listQuery = z.object({
  status: z.string().max(40).optional(),
  source: z.string().max(40).optional(),
  owner: z.string().max(30).optional(), // 'me' or an employee id
  due: z.enum(['today', 'overdue', 'week']).optional(),
  q: z.string().max(100).optional(),
  open: z.enum(['true']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(25),
});

enquiriesRouter.get(
  '/',
  anyRight,
  validate(listQuery, 'query'),
  ah(async (req, res) => {
    const { status, source, owner, due, q, open, page, limit } = req.query as unknown as z.infer<typeof listQuery>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    else if (open || due) filter.status = { $nin: [WON, LOST] };
    if (source) filter.source = source;
    if (owner === 'me') filter.owner = req.user!.employeeId;
    else if (owner) filter.owner = owner; // narrowing only: the scope below still applies
    const today = todayStr();
    if (due === 'today') filter.nextFollowUp = today;
    if (due === 'overdue') filter.nextFollowUp = { $lt: today };
    if (due === 'week') filter.nextFollowUp = { $lte: new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10) };
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      const k = phoneKey(q);
      filter.$or = [{ name: rx }, { company: rx }, { email: rx }, ...(k ? [{ phoneKey: k }] : [])];
    }
    const where = { $and: [await scope(req), filter] };
    const [items, total] = await Promise.all([
      Enquiry.find(where).select('-activity').populate('owner', OWNER).sort({ nextFollowUp: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Enquiry.countDocuments(where),
    ]);
    res.json({ items: items.map(view), total, page, limit });
  }),
);

enquiriesRouter.post(
  '/',
  requirePermission(P.ENQUIRIES_SELF, P.ENQUIRIES_MANAGE),
  validate(enquirySchema),
  ah(async (req, res) => {
    const b = req.body as z.infer<typeof enquirySchema>;
    const o = await getOptions();
    if (!o.sources.includes(b.source)) throw badRequest(`Unknown source "${b.source}"`);
    const status = b.status || o.stages[0];
    if (!o.stages.includes(status)) throw badRequest('A new enquiry starts in one of the open stages');
    if (b.nextFollowUp < todayStr()) throw badRequest('The follow-up date cannot be in the past');
    const me = requireEmployee(req);
    const owner = b.owner ?? String(me);
    if (!same(owner, me) && !hasPermission(req, P.ENQUIRIES_MANAGE)) throw forbidden('Only enquiry managers can start an enquiry for someone else');
    if (!(await Employee.exists({ _id: owner, status: { $ne: 'exited' } }))) throw badRequest('Owner must be a current employee');
    const key = phoneKey(b.phone);
    await assertNoDuplicate(key);
    const e = new Enquiry({ name: b.name, phone: b.phone, phoneKey: key, email: b.email || undefined, company: b.company || undefined, source: b.source, status, owner, nextFollowUp: b.nextFollowUp, createdBy: req.user!.id });
    await log(req, e, 'created', `Started in ${status}, follow up ${b.nextFollowUp}`);
    if (b.note) await log(req, e, 'note', b.note);
    await e.save();
    await audit({ actor: req.user!.id, action: 'enquiry.create', entity: 'Enquiry', entityId: e._id, meta: { name: e.name, source: e.source, owner } });
    res.status(201).json(e);
  }),
);

// ===================== One enquiry =====================
enquiriesRouter.get(
  '/:id',
  anyRight,
  idParam,
  ah(async (req, res) => {
    await loadFor(req, req.params.id);
    const e = await Enquiry.findById(req.params.id).populate('owner', OWNER).populate('client', 'name').populate('project', 'code name').lean();
    // the owner is populated here, so compare by its id
    const writable = canWrite(req, { owner: (e!.owner as unknown as { _id?: unknown } | null)?._id ?? e!.owner });
    res.json({ ...view(e), canWrite: writable, canConvert: writable && hasPermission(req, P.PROJECTS_MANAGE) && e!.status === WON && !e!.project });
  }),
);

enquiriesRouter.put(
  '/:id',
  anyRight,
  idParam,
  validate(enquiryUpdateSchema),
  ah(async (req, res) => res.json(await retrying(async () => {
    const e = await loadFor(req, req.params.id);
    assertWrite(req, e);
    const b = req.body as z.infer<typeof enquiryUpdateSchema>;
    const o = await getOptions();
    if (b.source && b.source !== e.source && !o.sources.includes(b.source)) throw badRequest(`Unknown source "${b.source}"`);
    const changes: string[] = [];
    if (b.phone) {
      const key = phoneKey(b.phone);
      if (key !== e.phoneKey) await assertNoDuplicate(key, String(e._id));
      if (b.phone !== e.phone) changes.push(`phone ${e.phone} → ${b.phone}`);
      e.phone = b.phone;
      e.phoneKey = key;
    }
    for (const k of ['name', 'email', 'company', 'source'] as const) {
      if (b[k] !== undefined && (b[k] || '') !== (e[k] || '')) {
        changes.push(`${k} changed`);
        (e as any)[k] = b[k] || undefined;
      }
    }
    if (b.owner && !same(b.owner, e.owner)) {
      if (!hasPermission(req, P.ENQUIRIES_MANAGE)) throw forbidden('Only enquiry managers can reassign');
      if (!(await Employee.exists({ _id: b.owner, status: { $ne: 'exited' } }))) throw badRequest('Owner must be a current employee');
      await log(req, e, 'owner', `Reassigned to ${await employeeName(b.owner)}`);
      e.owner = b.owner as never;
    }
    if (b.nextFollowUp && b.nextFollowUp !== e.nextFollowUp) {
      if (isClosed(e.status)) throw badRequest('A closed enquiry has no follow-up');
      await log(req, e, 'followup', `Follow-up ${e.nextFollowUp ?? 'none'} → ${b.nextFollowUp}`);
      e.nextFollowUp = b.nextFollowUp;
    }
    if (changes.length) await log(req, e, 'edit', changes.join(', '));
    await e.save();
    await audit({ actor: req.user!.id, action: 'enquiry.update', entity: 'Enquiry', entityId: e._id, meta: { changes } });
    return e;
  }))),
);

enquiriesRouter.post(
  '/:id/status',
  anyRight,
  idParam,
  validate(enquiryStatusSchema),
  ah(async (req, res) => res.json(await retrying(async () => {
    const e = await loadFor(req, req.params.id);
    assertWrite(req, e);
    const b = req.body as z.infer<typeof enquiryStatusSchema>;
    const o = await getOptions();
    if (!allStatuses(o).includes(b.status)) throw badRequest(`Unknown status "${b.status}"`);
    if (e.project) throw conflict('This enquiry has been converted to a project and can no longer change status');
    if (b.status === e.status) throw badRequest(`It is already ${b.status}`);
    const before = e.status;
    if (b.status === LOST) {
      if (!b.lostReason) throw badRequest('Say why it was lost');
      if (!o.lostReasons.includes(b.lostReason)) throw badRequest(`Unknown lost reason "${b.lostReason}"`);
      e.lostReason = b.lostReason;
      e.closedAt = now();
      e.nextFollowUp = undefined;
    } else if (b.status === WON) {
      e.lostReason = undefined;
      e.closedAt = now();
      e.nextFollowUp = undefined;
    } else {
      // an open stage always has a follow-up date; reopening a closed one needs a fresh date
      const next = b.nextFollowUp ?? e.nextFollowUp;
      if (!next) throw badRequest('Set the next follow-up date');
      if (b.nextFollowUp && b.nextFollowUp < todayStr()) throw badRequest('The follow-up date cannot be in the past');
      e.nextFollowUp = next;
      e.lostReason = undefined;
      e.closedAt = undefined;
    }
    e.status = b.status;
    await log(req, e, 'status', `${before} → ${b.status}${b.lostReason ? ` (${b.lostReason})` : ''}${b.note ? `: ${b.note}` : ''}`);
    await e.save();
    await audit({ actor: req.user!.id, action: 'enquiry.status', entity: 'Enquiry', entityId: e._id, meta: { from: before, to: b.status, lostReason: b.lostReason } });
    return e;
  }))),
);

enquiriesRouter.post(
  '/:id/notes',
  anyRight,
  idParam,
  validate(enquiryNoteSchema),
  ah(async (req, res) => res.json(await retrying(async () => {
    const e = await loadFor(req, req.params.id);
    assertWrite(req, e);
    const { text, nextFollowUp } = req.body as z.infer<typeof enquiryNoteSchema>;
    await log(req, e, 'note', text);
    if (nextFollowUp && nextFollowUp !== e.nextFollowUp) {
      if (isClosed(e.status)) throw badRequest('A closed enquiry has no follow-up');
      if (nextFollowUp < todayStr()) throw badRequest('The follow-up date cannot be in the past');
      await log(req, e, 'followup', `Follow-up ${e.nextFollowUp ?? 'none'} → ${nextFollowUp}`);
      e.nextFollowUp = nextFollowUp;
    }
    await e.save();
    return e;
  }))),
);

/** A Won enquiry becomes a client and a project, linked back so it cannot be converted twice. */
enquiriesRouter.post(
  '/:id/convert',
  requirePermission(P.PROJECTS_MANAGE),
  idParam,
  validate(enquiryConvertSchema),
  ah(async (req, res) => {
    const e = await loadFor(req, req.params.id);
    assertWrite(req, e);
    const b = req.body as z.infer<typeof enquiryConvertSchema>;
    if (e.status !== WON) throw conflict('Only a Won enquiry can be converted');
    if (e.project) throw conflict('This enquiry has already been converted');
    // A Manager can only start projects they lead themselves, as on the Projects screen
    if (!hasPermission(req, P.PROJECTS_VIEW) && !same(b.manager, req.user!.employeeId)) throw forbidden('You can only create projects that you lead');
    if (!(await Employee.exists({ _id: b.manager, status: { $ne: 'exited' } }))) throw badRequest('The project manager must be a current employee');
    if (await Project.exists({ code: b.projectCode })) throw conflict(`Project code ${b.projectCode} is already used`);
    let client = null;
    if (b.client) {
      client = await Client.findById(b.client);
      if (!client) throw badRequest('Client not found');
    } else {
      const name = (e.company || e.name).trim();
      client = (await Client.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') })) ?? (await Client.create({ name, contactName: e.name, email: e.email, phone: e.phone }));
    }
    const project = await Project.create({ code: b.projectCode, name: b.projectName, client: client._id, manager: b.manager, members: [b.manager], status: 'planning', billingType: b.billingType, createdBy: req.user!.id });
    // Claim the enquiry atomically: only one of two simultaneous conversions can win; the loser undoes what it created
    const claimed = await Enquiry.findOneAndUpdate(
      { _id: e._id, project: null },
      { $set: { client: client._id, project: project._id }, $push: { activity: { at: now(), by: req.user!.id, byName: await employeeName(req.user!.employeeId), kind: 'converted', text: `Converted to project ${project.code} for ${client.name}` } } },
      { new: true },
    );
    if (!claimed) {
      await project.deleteOne();
      throw conflict('This enquiry has already been converted');
    }
    await audit({ actor: req.user!.id, action: 'enquiry.convert', entity: 'Enquiry', entityId: e._id, meta: { project: project.code, client: client.name } });
    res.status(201).json({ enquiry: claimed, project: { _id: project._id, code: project.code, name: project.name }, client: { _id: client._id, name: client.name } });
  }),
);

enquiriesRouter.delete(
  '/:id',
  requirePermission(P.ENQUIRIES_MANAGE),
  idParam,
  ah(async (req, res) => {
    const e = await loadFor(req, req.params.id);
    if (e.project) throw conflict('A converted enquiry is kept as the record of where the project came from');
    await e.deleteOne();
    await audit({ actor: req.user!.id, action: 'enquiry.delete', entity: 'Enquiry', entityId: e._id, meta: { name: e.name, status: e.status } });
    res.json({ ok: true });
  }),
);
