import express, { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS, confidentialDocSchema, confidentialFolderSchema, objectId } from '@cms/shared';
import { hasPermission, requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { conflict, forbidden, notFound } from '../../utils/errors';
import dayjs from 'dayjs';
import { now, todayStr } from '../../utils/time';
import { audit } from '../audit/model';
import { Employee } from '../employees/model';
import { employeeName } from '../notifications/service';
import { Role, User } from '../users/model';
import { DOC_EXTENSIONS, checkUpload } from '../projects/files';
import { ConfidentialAccess, ConfidentialDoc, ConfidentialFile, ConfidentialFolder } from './model';

export const confidentialRouter = Router();
const P = PERMISSIONS;
const view = requirePermission(P.CONFIDENTIAL_VIEW, P.CONFIDENTIAL_MANAGE);
const manage = requirePermission(P.CONFIDENTIAL_MANAGE);
export const MAX_CONFIDENTIAL_BYTES = 15 * 1024 * 1024;
const raw = express.raw({ type: () => true, limit: MAX_CONFIDENTIAL_BYTES });
const fid = validate(z.object({ id: objectId }), 'params');
const did = validate(z.object({ docId: objectId }), 'params');
const vid = validate(z.object({ docId: objectId, versionId: objectId }), 'params');

const managesAll = (req: Request) => hasPermission(req, P.CONFIDENTIAL_MANAGE);
const isEditor = (req: Request, folder: { editors?: unknown[] }) =>
  managesAll(req) || (folder.editors ?? []).some((e) => String((e as any)?._id ?? e) === String(req.user!.employeeId));

async function folderOf(id: string) {
  const f = await ConfidentialFolder.findById(id);
  if (!f) throw notFound('Folder');
  return f;
}
async function docOf(req: Request) {
  const d = await ConfidentialDoc.findById(req.params.docId);
  if (!d) throw notFound('Document');
  return { d, folder: await folderOf(String(d.folder)) };
}
const sortVersions = (v: any[]) => [...(v ?? [])].sort((a, b) => b.version - a.version);
const presentDoc = (d: any, editor: boolean) => {
  const versions = sortVersions(d.versions);
  return {
    _id: d._id,
    folder: d.folder,
    title: d.title,
    description: d.description,
    expiresOn: d.expiresOn,
    remindDays: d.remindDays,
    createdByName: d.createdByName,
    updatedAt: d.updatedAt,
    latest: versions[0] ?? null,
    versions,
    canEdit: editor,
  };
};

// ----- Folders -----
confidentialRouter.get(
  '/folders',
  view,
  ah(async (req, res) => {
    const folders = await ConfidentialFolder.find().populate('editors', 'name code').sort({ name: 1 }).lean();
    const counts = await ConfidentialDoc.aggregate([{ $group: { _id: '$folder', n: { $sum: 1 } } }]);
    const n = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({
      items: folders.map((f) => ({ ...f, documents: n.get(String(f._id)) ?? 0, canEdit: isEditor(req, f) })),
      canManage: managesAll(req),
    });
  }),
);

/** People who may be made editors: anyone whose role can open the confidential area. */
confidentialRouter.get(
  '/people',
  manage,
  ah(async (_req, res) => {
    const roles = await Role.find({ permissions: { $in: [P.CONFIDENTIAL_VIEW, P.CONFIDENTIAL_MANAGE] } }).select('_id').lean();
    const users = await User.find({ role: { $in: roles.map((r) => r._id) }, status: 'active', employee: { $ne: null } }).select('employee').lean();
    res.json(await Employee.find({ _id: { $in: users.map((u) => u.employee) } }).select('name code designation type').sort({ name: 1 }).lean());
  }),
);

confidentialRouter.post(
  '/folders',
  manage,
  validate(confidentialFolderSchema),
  ah(async (req, res) => {
    if (await ConfidentialFolder.exists({ name: req.body.name })) throw conflict('A folder with that name exists');
    const f = await ConfidentialFolder.create({ ...req.body, createdBy: req.user!.id });
    await audit({ actor: req.user!.id, action: 'confidential.folder_create', entity: 'ConfidentialFolder', entityId: f._id, meta: { name: f.name } });
    res.status(201).json(f);
  }),
);

confidentialRouter.put(
  '/folders/:id',
  manage,
  fid,
  validate(confidentialFolderSchema),
  ah(async (req, res) => {
    const f = await folderOf(req.params.id);
    if (await ConfidentialFolder.exists({ name: req.body.name, _id: { $ne: f._id } })) throw conflict('A folder with that name exists');
    const before = { name: f.name, editors: f.editors.map(String) };
    f.set(req.body);
    await f.save();
    await audit({ actor: req.user!.id, action: 'confidential.folder_update', entity: 'ConfidentialFolder', entityId: f._id, before, after: { name: f.name, editors: f.editors.map(String) } });
    res.json(f);
  }),
);

confidentialRouter.delete(
  '/folders/:id',
  manage,
  fid,
  ah(async (req, res) => {
    const f = await folderOf(req.params.id);
    if (await ConfidentialDoc.exists({ folder: f._id })) throw conflict('Move or delete the documents in this folder first');
    await f.deleteOne();
    await audit({ actor: req.user!.id, action: 'confidential.folder_delete', entity: 'ConfidentialFolder', entityId: f._id, meta: { name: f.name } });
    res.json({ ok: true });
  }),
);

// ----- Documents -----
confidentialRouter.get(
  '/folders/:id/documents',
  view,
  fid,
  ah(async (req, res) => {
    const f = await folderOf(req.params.id);
    const docs = await ConfidentialDoc.find({ folder: f._id }).sort({ title: 1 }).lean();
    const editor = isEditor(req, f);
    res.json({ folder: { _id: f._id, name: f.name, description: f.description }, items: docs.map((d) => presentDoc(d, editor)), canEdit: editor, maxBytes: MAX_CONFIDENTIAL_BYTES, allowed: DOC_EXTENSIONS });
  }),
);

/** Documents due for renewal or review: already past, or inside their reminder window. */
confidentialRouter.get(
  '/expiring',
  view,
  ah(async (_req, res) => {
    const docs = await ConfidentialDoc.find({ expiresOn: { $ne: null } }).populate('folder', 'name').select('title folder expiresOn remindDays').sort({ expiresOn: 1 }).lean();
    const today = todayStr();
    const soon = docs.filter((d) => dayjs(d.expiresOn!).subtract(d.remindDays ?? 30, 'day').format('YYYY-MM-DD') <= today);
    res.json(soon.map((d) => ({ ...d, overdue: d.expiresOn! < today })));
  }),
);

const uploadQuery = z.object({ name: z.string().min(1).max(200), note: z.string().max(300).optional() });

confidentialRouter.post(
  '/folders/:id/documents',
  view,
  fid,
  validate(uploadQuery.merge(confidentialDocSchema), 'query'),
  raw,
  ah(async (req, res) => {
    const f = await folderOf(req.params.id);
    if (!isEditor(req, f)) throw forbidden('Only this folder\'s editors can add documents');
    const q = req.query as unknown as z.infer<typeof uploadQuery> & z.infer<typeof confidentialDocSchema>;
    const file = checkUpload(q.name, req.body, true);
    const by = await employeeName(req.user!.employeeId);
    const d = new ConfidentialDoc({
      folder: f._id,
      title: q.title,
      description: q.description || '',
      expiresOn: q.expiresOn || null,
      remindDays: q.remindDays,
      createdBy: req.user!.id,
      createdByName: by,
      versions: [{ version: 1, name: file.name, mime: file.mime, size: file.data.length, note: q.note || '', uploadedBy: req.user!.id, uploadedByName: by, at: now() }],
    });
    await ConfidentialFile.create({ doc: d._id, version: d.versions[0]._id, data: file.data });
    await d.save();
    await audit({ actor: req.user!.id, action: 'confidential.doc_add', entity: 'ConfidentialDoc', entityId: d._id, meta: { folder: f.name, title: d.title, name: file.name } });
    res.status(201).json(presentDoc(d.toObject(), true));
  }),
);

confidentialRouter.post(
  '/documents/:docId/versions',
  view,
  did,
  validate(uploadQuery, 'query'),
  raw,
  ah(async (req, res) => {
    const { d, folder } = await docOf(req);
    if (!isEditor(req, folder)) throw forbidden('Only this folder\'s editors can upload versions');
    const q = req.query as unknown as z.infer<typeof uploadQuery>;
    const file = checkUpload(q.name, req.body, true);
    const version = Math.max(0, ...d.versions.map((v) => v.version)) + 1;
    const entry = { version, name: file.name, mime: file.mime, size: file.data.length, note: q.note || '', uploadedBy: req.user!.id, uploadedByName: await employeeName(req.user!.employeeId), at: now() };
    const updated = await ConfidentialDoc.findOneAndUpdate({ _id: d._id }, { $push: { versions: entry } }, { new: true });
    const added = updated!.versions[updated!.versions.length - 1];
    await ConfidentialFile.create({ doc: d._id, version: added._id, data: file.data });
    await audit({ actor: req.user!.id, action: 'confidential.doc_version', entity: 'ConfidentialDoc', entityId: d._id, meta: { folder: folder.name, title: d.title, version } });
    res.status(201).json(presentDoc(updated!.toObject(), true));
  }),
);

confidentialRouter.put(
  '/documents/:docId',
  view,
  did,
  validate(confidentialDocSchema.extend({ folder: objectId.optional() })),
  ah(async (req, res) => {
    const { d, folder } = await docOf(req);
    if (!isEditor(req, folder)) throw forbidden('Only this folder\'s editors can edit documents');
    const b = req.body as z.infer<typeof confidentialDocSchema> & { folder?: string };
    if (b.folder && b.folder !== String(d.folder)) {
      const target = await folderOf(b.folder);
      if (!isEditor(req, target)) throw forbidden('You are not an editor of the folder you are moving it to');
      d.folder = target._id;
    }
    d.set({ title: b.title, description: b.description || '', expiresOn: b.expiresOn || null, remindDays: b.remindDays });
    await d.save();
    await audit({ actor: req.user!.id, action: 'confidential.doc_update', entity: 'ConfidentialDoc', entityId: d._id, meta: { title: d.title } });
    res.json(presentDoc(d.toObject(), true));
  }),
);

/** Download. Every open is recorded in the access log, whoever it is. */
confidentialRouter.get(
  '/documents/:docId/versions/:versionId',
  view,
  vid,
  ah(async (req, res) => {
    const { d } = await docOf(req);
    const v = d.versions.id(req.params.versionId);
    if (!v) throw notFound('Version');
    const f = await ConfidentialFile.findOne({ version: v._id });
    if (!f) throw notFound('File');
    await ConfidentialAccess.create({ doc: d._id, folder: d.folder, title: d.title, version: v.version, user: req.user!.id, userName: await employeeName(req.user!.employeeId), ip: req.ip, at: now() });
    await audit({ actor: req.user!.id, action: 'confidential.doc_download', entity: 'ConfidentialDoc', entityId: d._id, meta: { title: d.title, version: v.version }, ip: req.ip });
    res.setHeader('Content-Type', v.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.attachment(v.name);
    res.send(f.data);
  }),
);

/** Who opened this document and when. */
confidentialRouter.get(
  '/documents/:docId/access',
  view,
  did,
  ah(async (req, res) => {
    const { d } = await docOf(req);
    res.json(await ConfidentialAccess.find({ doc: d._id }).select('version userName ip at').sort({ at: -1 }).limit(200).lean());
  }),
);

confidentialRouter.delete(
  '/documents/:docId',
  view,
  did,
  ah(async (req, res) => {
    const { d, folder } = await docOf(req);
    if (!isEditor(req, folder)) throw forbidden('Only this folder\'s editors can delete documents');
    await ConfidentialFile.deleteMany({ doc: d._id });
    await d.deleteOne(); // the access log is kept
    await audit({ actor: req.user!.id, action: 'confidential.doc_delete', entity: 'ConfidentialDoc', entityId: d._id, before: { folder: folder.name, title: d.title, versions: d.versions.length } });
    res.json({ ok: true });
  }),
);
