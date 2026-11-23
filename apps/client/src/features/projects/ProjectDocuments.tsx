import { Fragment, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ChevronDown, ChevronRight, Download, FileUp, History, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PROJECT_DOC_CATEGORIES, PROJECT_DOC_CATEGORY_LABEL } from '@cms/shared';
import { api, apiError } from '@/api/client';
import { useGet, useSend } from '@/api/hooks';
import { downloadFile } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { fmtSize } from './TaskFiles';
import type { TaskRow } from './types';

interface Version {
  _id: string;
  version: number;
  name: string;
  size: number;
  note?: string;
  uploadedByName?: string;
  at: string;
}
interface Doc {
  _id: string;
  title: string;
  category: keyof typeof PROJECT_DOC_CATEGORY_LABEL;
  description?: string;
  task?: { _id: string; number: number; title: string } | null;
  createdByName?: string;
  updatedAt: string;
  latest: Version | null;
  versions: Version[];
  canEdit: boolean;
}
interface DocList {
  items: Doc[];
  canUpload: boolean;
  maxBytes: number;
  allowed: string[];
  projectCode: string;
}

const catLabel = (c: string) => PROJECT_DOC_CATEGORY_LABEL[c as keyof typeof PROJECT_DOC_CATEGORY_LABEL] ?? c;
const rawUpload = (url: string, file: File, params: Record<string, string | undefined>) =>
  api.post(url, file, { params, headers: { 'Content-Type': file.type || 'application/octet-stream' }, transformRequest: [(d) => d] });

function problem(f: File, list: DocList) {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
  if (!list.allowed.includes(ext)) return `.${ext || '?'} files are not allowed. Use: ${list.allowed.join(', ')}`;
  if (!f.size) return 'The file is empty';
  if (f.size > list.maxBytes) return `The file is ${fmtSize(f.size)}; the limit is ${fmtSize(list.maxBytes)}`;
  return null;
}

/** Project documents: briefs, drawings, contracts and so on, each with its full version history. */
export function ProjectDocuments({ projectId }: { projectId: string }) {
  const [view, setView] = useViewMode('project-docs');
  const { data } = useGet<DocList>(['projects', 'documents', projectId], `/projects/${projectId}/documents`);
  const [cat, setCat] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [newVersion, setNewVersion] = useState<Doc | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const del = useSend<string>('delete', (docId) => `/projects/${projectId}/documents/${docId}`, { invalidate: [['projects', 'documents']], success: 'Document deleted' });
  if (!data) return null;
  const items = cat ? data.items.filter((d) => d.category === cat) : data.items;
  const base = `/projects/${projectId}/documents`;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="w-52" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories ({data.items.length})</option>
          {PROJECT_DOC_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {catLabel(c)} ({data.items.filter((d) => d.category === c).length})
            </option>
          ))}
        </Select>
        {data.canUpload && (
          <Button className="ml-auto" onClick={() => setAdding(true)}>
            <Plus /> Add document
          </Button>
        )}
      </div>
      <>
        <div className="mb-2 flex justify-end">
          <ViewToggle mode={view} onChange={setView} />
        </div>
        {view === 'list' ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH />
                  <TH>Document</TH>
                  <TH>Category</TH>
                  <TH>Latest file</TH>
                  <TH>Version</TH>
                  <TH>Updated</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {!items.length && <EmptyRow cols={7} text="No documents yet. Add briefs, drawings, contracts or anything that explains the work." />}
                {items.map((d) => (
                  <Fragment key={d._id}>
                    <TR>
                      <TD className="w-8">
                        {d.versions.length > 1 && (
                          <button aria-label="Show versions" onClick={() => setOpen((o) => ({ ...o, [d._id]: !o[d._id] }))}>
                            {open[d._id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        )}
                      </TD>
                      <TD>
                        <div className="font-medium">{d.title}</div>
                        {d.description && <div className="max-w-md text-xs text-muted-foreground">{d.description}</div>}
                        {d.task && (
                          <div className="text-xs text-muted-foreground">
                            Task {data.projectCode}-{d.task.number}: {d.task.title}
                          </div>
                        )}
                      </TD>
                      <TD className="text-sm">{catLabel(d.category)}</TD>
                      <TD className="text-xs">
                        {d.latest && (
                          <>
                            <div className="max-w-[14rem] truncate">{d.latest.name}</div>
                            <div className="text-muted-foreground">{fmtSize(d.latest.size)}</div>
                          </>
                        )}
                      </TD>
                      <TD>v{d.latest?.version}</TD>
                      <TD className="whitespace-nowrap text-xs">
                        {d.latest && dayjs(d.latest.at).format('DD MMM YYYY')}
                        <div className="text-muted-foreground">{d.latest?.uploadedByName}</div>
                      </TD>
                      <TD className="whitespace-nowrap text-right">
                        {d.latest && (
                          <Button size="icon" variant="ghost" aria-label="Download" title="Download latest" onClick={() => downloadFile(`${base}/${d._id}/versions/${d.latest!._id}`, d.latest!.name)}>
                            <Download />
                          </Button>
                        )}
                        {data.canUpload && (
                          <Button size="icon" variant="ghost" aria-label="Upload new version" title="Upload a new version" onClick={() => setNewVersion(d)}>
                            <FileUp />
                          </Button>
                        )}
                        {d.canEdit && data.canUpload && (
                          <Button size="icon" variant="ghost" aria-label="Edit details" title="Edit details" onClick={() => setEditing(d)}>
                            <Pencil />
                          </Button>
                        )}
                        {d.canEdit && (
                          <Button size="icon" variant="ghost" className="text-destructive" aria-label="Delete" title="Delete document and all versions" onClick={() => window.confirm(`Delete "${d.title}" and all its versions?`) && del.mutate(d._id)}>
                            <Trash2 />
                          </Button>
                        )}
                      </TD>
                    </TR>
                    {open[d._id] &&
                      d.versions.map((v) => (
                        <TR key={v._id} className="bg-muted/30 text-xs">
                          <TD />
                          <TD colSpan={2} className="pl-6">
                            <History className="mr-1 inline h-3 w-3" /> v{v.version} {v.note && <span className="text-muted-foreground">— {v.note}</span>}
                          </TD>
                          <TD>
                            {v.name} · {fmtSize(v.size)}
                          </TD>
                          <TD />
                          <TD>
                            {dayjs(v.at).format('DD MMM YYYY HH:mm')}
                            <div className="text-muted-foreground">{v.uploadedByName}</div>
                          </TD>
                          <TD className="text-right">
                            <Button size="icon" variant="ghost" aria-label={`Download version ${v.version}`} onClick={() => downloadFile(`${base}/${d._id}/versions/${v._id}`, v.name)}>
                              <Download />
                            </Button>
                          </TD>
                        </TR>
                      ))}
                  </Fragment>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        ) : (
        <CardGrid
          items={items}
          empty="No documents yet."
          render={(d) => (
            <Card key={d._id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{d.title}</div>
                    <div className="text-xs text-muted-foreground">{catLabel(d.category)} · v{d.latest?.version}</div>
                  </div>
                </div>
                {d.description && <div className="line-clamp-2 text-xs text-muted-foreground">{d.description}</div>}
                {d.latest && <CardLine label="File">{d.latest.name} · {fmtSize(d.latest.size)}</CardLine>}
                {d.latest && <CardLine label="Updated">{dayjs(d.latest.at).format('DD MMM YYYY')} · {d.latest.uploadedByName}</CardLine>}
                {d.task && <CardLine label="Task">{data.projectCode}-{d.task.number}</CardLine>}
                <div className="flex justify-end gap-1 border-t pt-2">
                  {d.latest && <Button size="icon" variant="ghost" aria-label="Download" onClick={() => downloadFile(`${base}/${d._id}/versions/${d.latest!._id}`, d.latest!.name)}><Download /></Button>}
                  {data.canUpload && <Button size="icon" variant="ghost" aria-label="Upload new version" onClick={() => setNewVersion(d)}><FileUp /></Button>}
                  {d.canEdit && data.canUpload && <Button size="icon" variant="ghost" aria-label="Edit details" onClick={() => setEditing(d)}><Pencil /></Button>}
                  {d.canEdit && <Button size="icon" variant="ghost" className="text-destructive" aria-label="Delete" onClick={() => window.confirm(`Delete "${d.title}" and all its versions?`) && del.mutate(d._id)}><Trash2 /></Button>}
                </div>
              </CardContent>
            </Card>
          )}
        />
        )}
      </>
      <p className="mt-2 text-xs text-muted-foreground">
        Any project member can add documents and upload newer versions; every version is kept. Allowed: {data.allowed.join(', ')} · up to {fmtSize(data.maxBytes)} each.
      </p>
      <DocDialog projectId={projectId} list={data} open={adding} onClose={() => setAdding(false)} />
      <DocDialog projectId={projectId} list={data} open={!!editing} editing={editing} onClose={() => setEditing(null)} />
      <VersionDialog projectId={projectId} list={data} doc={newVersion} onClose={() => setNewVersion(null)} />
    </>
  );
}

/** Add a document (with its first file) or edit an existing one's details. */
function DocDialog({ projectId, list, open, editing, onClose }: { projectId: string; list: DocList; open: boolean; editing?: Doc | null; onClose: () => void }) {
  const qc = useQueryClient();
  const tasks = useGet<TaskRow[]>(['projects', 'tasks', projectId, 'docpicker'], `/projects/${projectId}/tasks`, undefined, open);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setFile(null);
      setTitle(editing?.title ?? '');
      setCategory(editing?.category ?? 'other');
      setDescription(editing?.description ?? '');
      setTask(editing?.task?._id ?? '');
    }
  }

  async function save() {
    setBusy(true);
    try {
      if (editing) {
        await api.put(`/projects/${projectId}/documents/${editing._id}`, { title, category, description, task: task || null });
        toast.success('Saved');
      } else {
        if (!file) return;
        const bad = problem(file, list);
        if (bad) return void toast.error(bad);
        await rawUpload(`/projects/${projectId}/documents`, file, { name: file.name, title, category, description: description || undefined, task: task || undefined });
        toast.success('Document added');
      }
      qc.invalidateQueries({ queryKey: ['projects', 'documents'] });
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit document details' : 'Add a document'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!editing && (
            <Field label="File">
              <input
                ref={fileRef}
                type="file"
                accept={list.allowed.map((e) => `.${e}`).join(',')}
                className="block w-full text-sm"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
                }}
              />
            </Field>
          )}
          <Field label="Title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client brief, Floor plan, Signed agreement" />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {PROJECT_DOC_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {catLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Related task (optional)">
            <Select value={task} onChange={(e) => setTask(e.target.value)}>
              <option value="">Whole project</option>
              {tasks.data?.map((t) => (
                <option key={t._id} value={t._id}>
                  {list.projectCode}-{t.number} · {t.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description (optional)">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it is and why it matters" />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={busy || title.trim().length < 2 || (!editing && !file)} onClick={save}>
            <Upload /> {editing ? 'Save' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionDialog({ projectId, list, doc, onClose }: { projectId: string; list: DocList; doc: Doc | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastDoc, setLastDoc] = useState<Doc | null>(null);
  if (doc !== lastDoc) {
    setLastDoc(doc);
    setFile(null);
    setNote('');
  }
  async function save() {
    if (!doc || !file) return;
    const bad = problem(file, list);
    if (bad) return void toast.error(bad);
    setBusy(true);
    try {
      await rawUpload(`/projects/${projectId}/documents/${doc._id}/versions`, file, { name: file.name, note: note || undefined });
      toast.success(`Version ${(doc.latest?.version ?? 0) + 1} uploaded`);
      qc.invalidateQueries({ queryKey: ['projects', 'documents'] });
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New version of "{doc?.title}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">The current file (v{doc?.latest?.version}) is kept in the history.</p>
          <Field label="File">
            <input type="file" accept={list.allowed.map((e) => `.${e}`).join(',')} className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="What changed (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client's revisions, final signed copy" />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={busy || !file} onClick={save}>
            <Upload /> Upload version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
