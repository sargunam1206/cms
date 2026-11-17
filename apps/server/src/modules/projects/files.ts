import express, { Router } from 'express';
import type { Request } from 'express';
import { Schema, model } from 'mongoose';
import { z } from 'zod';
import { objectId } from '@cms/shared';
import '../../config/istPlugin';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ah } from '../../utils/asyncHandler';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { audit } from '../audit/model';
import { employeeName } from '../notifications/service';
import { canManage, projectForCaller } from './access';
import { Task } from './model';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_TASK = 10;

const fileSchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false }, // never loaded for lists
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: String,
  },
  { timestamps: true },
);
export const TaskFile = model('TaskFile', fileSchema);

type Kind = 'pdf' | 'png' | 'jpg' | 'gif' | 'webp' | 'zip' | 'ole' | 'text';
/** What may be attached. The type comes from the extension; the first bytes must then agree with it. */
const TYPES: Record<string, { mime: string; kind: Kind }> = {
  pdf: { mime: 'application/pdf', kind: 'pdf' },
  png: { mime: 'image/png', kind: 'png' },
  jpg: { mime: 'image/jpeg', kind: 'jpg' },
  jpeg: { mime: 'image/jpeg', kind: 'jpg' },
  gif: { mime: 'image/gif', kind: 'gif' },
  webp: { mime: 'image/webp', kind: 'webp' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'zip' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'zip' },
  xls: { mime: 'application/vnd.ms-excel', kind: 'ole' },
  doc: { mime: 'application/msword', kind: 'ole' },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'ole' },
  csv: { mime: 'text/csv', kind: 'text' },
  txt: { mime: 'text/plain', kind: 'text' },
};
export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

const startsWith = (b: Buffer, ...bytes: number[]) => bytes.every((x, i) => b[i] === x);
function looksLike(kind: Kind, b: Buffer) {
  switch (kind) {
    case 'pdf': return startsWith(b, 0x25, 0x50, 0x44, 0x46);
    case 'png': return startsWith(b, 0x89, 0x50, 0x4e, 0x47);
    case 'jpg': return startsWith(b, 0xff, 0xd8, 0xff);
    case 'gif': return startsWith(b, 0x47, 0x49, 0x46, 0x38);
    case 'webp': return startsWith(b, 0x52, 0x49, 0x46, 0x46) && b.subarray(8, 12).toString() === 'WEBP';
    case 'zip': return startsWith(b, 0x50, 0x4b);
    case 'ole': return startsWith(b, 0xd0, 0xcf, 0x11, 0xe0);
    case 'text': return !b.subarray(0, 4096).includes(0); // plain text has no NUL bytes
  }
}

const cleanName = (raw: string) =>
  raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);

export const taskFilesRouter = Router();
const anyRight = requirePermission('tasks.self', 'projects.view', 'projects.manage');
const idParam = validate(z.object({ id: objectId }), 'params');
const fileParams = validate(z.object({ id: objectId, fileId: objectId }), 'params');

async function taskAndProject(req: Request, id: string) {
  const t = await Task.findById(id).select('project number title assignee');
  if (!t) throw notFound('Task');
  const p = await projectForCaller(req, String(t.project)); // 404 for people outside the project
  return { t, p };
}
const isAssignee = (req: Request, t: { assignee?: unknown }) => t.assignee != null && String(t.assignee) === String(req.user!.employeeId);
const meta = (f: { _id: unknown; name: string; mime: string; size: number; uploadedByName?: string | null; createdAt?: Date }) => ({ _id: f._id, name: f.name, mime: f.mime, size: f.size, uploadedByName: f.uploadedByName, createdAt: f.createdAt });

taskFilesRouter.get(
  '/tasks/:id/files',
  anyRight,
  idParam,
  ah(async (req, res) => {
    const { t, p } = await taskAndProject(req, req.params.id);
    const files = await TaskFile.find({ task: t._id }).sort({ createdAt: 1 }).lean();
    res.json({ canUpload: canManage(req, p) || isAssignee(req, t), maxBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES_PER_TASK, allowed: ALLOWED_EXTENSIONS, items: files.map((f) => ({ ...meta(f), canDelete: canManage(req, p) || String(f.uploadedBy) === String(req.user!.id) })) });
  }),
);

/** The file itself is the request body; its name is in ?name=. */
taskFilesRouter.post(
  '/tasks/:id/files',
  anyRight,
  idParam,
  validate(z.object({ name: z.string().min(1).max(200) }), 'query'),
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  ah(async (req, res) => {
    const { t, p } = await taskAndProject(req, req.params.id);
    if (!canManage(req, p) && !isAssignee(req, t)) throw forbidden('Only the project manager or the person the task is assigned to can attach files');
    if (['completed', 'cancelled'].includes(p.status)) throw conflict(`This project is ${p.status}; files can no longer be added`);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || !body.length) throw badRequest('The file is empty');
    const name = cleanName(String((req.query as { name: string }).name));
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    const type = TYPES[ext];
    if (!type) throw badRequest(`.${ext || '?'} files are not allowed. Use: ${ALLOWED_EXTENSIONS.join(', ')}`);
    if (!looksLike(type.kind, body)) throw badRequest(`"${name}" does not look like a real .${ext} file`);
    if ((await TaskFile.countDocuments({ task: t._id })) >= MAX_FILES_PER_TASK) throw conflict(`A task can have at most ${MAX_FILES_PER_TASK} files`);
    const f = await TaskFile.create({ task: t._id, project: p._id, name, mime: type.mime, size: body.length, data: body, uploadedBy: req.user!.id, uploadedByName: await employeeName(req.user!.employeeId) });
    await audit({ actor: req.user!.id, action: 'task.file.add', entity: 'Task', entityId: t._id, meta: { project: p.code, task: t.number, name, size: body.length } });
    res.status(201).json(meta(f));
  }),
);

taskFilesRouter.get(
  '/tasks/:id/files/:fileId',
  anyRight,
  fileParams,
  ah(async (req, res) => {
    const { t } = await taskAndProject(req, req.params.id);
    const f = await TaskFile.findOne({ _id: req.params.fileId, task: t._id }).select('+data');
    if (!f) throw notFound('File');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.attachment(f.name); // always a download, never rendered in the page
    res.send(f.data);
  }),
);

taskFilesRouter.delete(
  '/tasks/:id/files/:fileId',
  anyRight,
  fileParams,
  ah(async (req, res) => {
    const { t, p } = await taskAndProject(req, req.params.id);
    const f = await TaskFile.findOne({ _id: req.params.fileId, task: t._id }).select('name uploadedBy');
    if (!f) throw notFound('File');
    if (!canManage(req, p) && String(f.uploadedBy) !== String(req.user!.id)) throw forbidden('Only the project manager or the person who attached it can remove a file');
    await f.deleteOne();
    await audit({ actor: req.user!.id, action: 'task.file.remove', entity: 'Task', entityId: t._id, meta: { project: p.code, task: t.number, name: f.name } });
    res.json({ ok: true });
  }),
);

/** Used when a task is deleted, so its files do not linger. */
export const removeFilesOfTask = (taskId: unknown) => TaskFile.deleteMany({ task: taskId });
