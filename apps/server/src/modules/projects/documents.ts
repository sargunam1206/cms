import express, { Router } from 'express';
import type { Request } from 'express';
import { Schema, model } from 'mongoose';
import { z } from 'zod';
import { PROJECT_DOC_CATEGORIES, objectId, projectDocSchema } from '@cms/shared';
import '../../config/istPlugin';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { conflict, forbidden, notFound } from '../../utils/errors';
import { now } from '../../utils/time';
import { audit } from '../audit/model';
import { employeeName } from '../notifications/service';
import { canManage, projectForCaller } from './access';
import { DOC_EXTENSIONS, checkUpload } from './files';
import { Task } from './model';

/** One stored document is kept under MongoDB's 16 MB record limit. */
export const MAX_DOC_BYTES = 15 * 1024 * 1024;

const versionSchema = new Schema(
  {
    version: { type: Number, required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    note: String,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: String,
    at: { type: Date, required: true },
  },
  { _id: true },
);

/** A project document (brief, drawing, contract...) with every uploaded version kept. The bytes live in ProjectDocFile. */
const docSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: PROJECT_DOC_CATEGORIES, default: 'other' },
    description: String,
    task: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    versions: { type: [versionSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true },
);
export const ProjectDoc = model('ProjectDoc', docSchema);

const docFileSchema = new Schema({
  doc: { type: Schema.Types.ObjectId, ref: 'ProjectDoc', required: true, index: true },
  version: { type: Schema.Types.ObjectId, required: true, unique: true }, // the version subdocument's _id
  data: { type: Buffer, required: true },
});
export const ProjectDocFile = model('ProjectDocFile', docFileSchema);

export const projectDocsRouter = Router();
const anyRight = requirePermission('tasks.self', 'projects.view', 'projects.manage');
const pid = validate(z.object({ id: objectId }), 'params');
const did = validate(z.object({ id: objectId, docId: objectId }), 'params');
const vid = validate(z.object({ id: objectId, docId: objectId, versionId: objectId }), 'params');
const raw = express.raw({ type: () => true, limit: MAX_DOC_BYTES });

const isOwner = (req: Request, d: { createdBy?: unknown }) => String(d.createdBy) === String(req.user!.id);
/** Only active projects take new files; a completed or cancelled project's documents stay readable. */
function assertOpen(p: { status: string }) {
  if (['completed', 'cancelled'].includes(p.status)) throw conflict(`This project is ${p.status}; documents can no longer be added or changed`);
}
async function taskOf(projectId: unknown, task?: string | null) {
  if (!task) return null;
  if (!(await Task.exists({ _id: task, project: projectId }))) throw notFound('Task');
  return task;
}
async function loadDoc(req: Request) {
  const p = await projectForCaller(req, req.params.id); // 404 for people outside the project
  const d = await ProjectDoc.findOne({ _id: req.params.docId, project: p._id });
  if (!d) throw notFound('Document');
  return { p, d };
}
const present = (req: Request, p: any, d: any) => {
  const versions = [...(d.versions ?? [])].sort((a, b) => b.version - a.version);
  return {
    _id: d._id,
    title: d.title,
    category: d.category,
    description: d.description,
    task: d.task,
    createdByName: d.createdByName,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    latest: versions[0] ?? null,
    versions,
    canEdit: canManage(req, p) || isOwner(req, d),
  };
};

const uploadQuery = z.object({ name: z.string().min(1).max(200), note: z.string().max(300).optional() });

projectDocsRouter.get(
  '/:id/documents',
  anyRight,
  pid,
  ah(async (req, res) => {
    const p = await projectForCaller(req, req.params.id);
    const docs = await ProjectDoc.find({ project: p._id }).populate('task', 'number title').sort({ updatedAt: -1 }).lean();
    res.json({ items: docs.map((d) => present(req, p, d)), canUpload: !['completed', 'cancelled'].includes(p.status), maxBytes: MAX_DOC_BYTES, allowed: DOC_EXTENSIONS, projectCode: p.code });
  }),
);

/** New document: the file is the request body; title, category etc. come in the query string. Any project member may add one. */
projectDocsRouter.post(
  '/:id/documents',
  anyRight,
  pid,
  validate(uploadQuery.merge(projectDocSchema), 'query'),
  raw,
  ah(async (req, res) => {
    const p = await projectForCaller(req, req.params.id);
    assertOpen(p);
    const q = req.query as unknown as z.infer<typeof uploadQuery> & z.infer<typeof projectDocSchema>;
    const file = checkUpload(q.name, req.body, true);
    const by = await employeeName(req.user!.employeeId);
    const d = new ProjectDoc({
      project: p._id,
      title: q.title,
      category: q.category,
      description: q.description || '',
      task: await taskOf(p._id, q.task),
      createdBy: req.user!.id,
      createdByName: by,
      versions: [{ version: 1, name: file.name, mime: file.mime, size: file.data.length, note: q.note || '', uploadedBy: req.user!.id, uploadedByName: by, at: now() }],
    });
    await ProjectDocFile.create({ doc: d._id, version: d.versions[0]._id, data: file.data });
    await d.save();
    await audit({ actor: req.user!.id, action: 'project.document.add', entity: 'Project', entityId: p._id, meta: { project: p.code, doc: String(d._id), title: d.title, name: file.name, size: file.data.length } });
    res.status(201).json(present(req, p, d.toObject()));
  }),
);

/** Upload a newer version. Any member may (it is a shared document); earlier versions stay downloadable. */
projectDocsRouter.post(
  '/:id/documents/:docId/versions',
  anyRight,
  did,
  validate(uploadQuery, 'query'),
  raw,
  ah(async (req, res) => {
    const { p, d } = await loadDoc(req);
    assertOpen(p);
    const q = req.query as unknown as z.infer<typeof uploadQuery>;
    const file = checkUpload(q.name, req.body, true);
    const version = Math.max(0, ...d.versions.map((v) => v.version)) + 1;
    const entry = { version, name: file.name, mime: file.mime, size: file.data.length, note: q.note || '', uploadedBy: req.user!.id, uploadedByName: await employeeName(req.user!.employeeId), at: now() };
    // atomic push, so two people uploading at once both get a version (numbers may tie only in that rare race; both are kept)
    const updated = await ProjectDoc.findOneAndUpdate({ _id: d._id }, { $push: { versions: entry } }, { new: true });
    const added = updated!.versions[updated!.versions.length - 1];
    await ProjectDocFile.create({ doc: d._id, version: added._id, data: file.data });
    await audit({ actor: req.user!.id, action: 'project.document.version', entity: 'Project', entityId: p._id, meta: { project: p.code, doc: String(d._id), title: d.title, version, name: file.name } });
    res.status(201).json(present(req, p, updated!.toObject()));
  }),
);

projectDocsRouter.put(
  '/:id/documents/:docId',
  anyRight,
  did,
  validate(projectDocSchema),
  ah(async (req, res) => {
    const { p, d } = await loadDoc(req);
    if (!canManage(req, p) && !isOwner(req, d)) throw forbidden('Only the person who added it or the project manager can edit this document');
    assertOpen(p);
    const b = req.body as z.infer<typeof projectDocSchema>;
    d.set({ title: b.title, category: b.category, description: b.description || '', task: await taskOf(p._id, b.task) });
    await d.save();
    res.json(present(req, p, d.toObject()));
  }),
);

projectDocsRouter.get(
  '/:id/documents/:docId/versions/:versionId',
  anyRight,
  vid,
  ah(async (req, res) => {
    const { p, d } = await loadDoc(req);
    const v = d.versions.id(req.params.versionId);
    if (!v) throw notFound('Version');
    const f = await ProjectDocFile.findOne({ version: v._id }); // not lean: lean returns a BSON Binary, not a Buffer
    if (!f) throw notFound('File');
    await audit({ actor: req.user!.id, action: 'project.document.download', entity: 'Project', entityId: p._id, meta: { project: p.code, doc: String(d._id), title: d.title, version: v.version } });
    res.setHeader('Content-Type', v.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.attachment(v.name);
    res.send(f.data);
  }),
);

projectDocsRouter.delete(
  '/:id/documents/:docId',
  anyRight,
  did,
  ah(async (req, res) => {
    const { p, d } = await loadDoc(req);
    if (!canManage(req, p) && !isOwner(req, d)) throw forbidden('Only the person who added it or the project manager can delete this document');
    await ProjectDocFile.deleteMany({ doc: d._id });
    await d.deleteOne();
    await audit({ actor: req.user!.id, action: 'project.document.remove', entity: 'Project', entityId: p._id, meta: { project: p.code, doc: String(d._id), title: d.title, versions: d.versions.length } });
    res.json({ ok: true });
  }),
);
