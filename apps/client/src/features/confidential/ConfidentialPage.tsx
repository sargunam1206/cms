import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { AlertTriangle, ChevronDown, ChevronRight, Download, Eye, FileUp, Folder, FolderPlus, History, Lock, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/api/client';
import { useGet, useSend } from '@/api/hooks';
import { cn } from '@/lib/utils';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { fmtSize } from '@/features/projects/TaskFiles';
import { PersonOptions } from '@/components/common/PersonOptions';

interface PersonRef {
  _id: string;
  name: string;
  code?: string;
  designation?: string;
  type?: string;
}
interface FolderRow {
  _id: string;
  name: string;
  description?: string;
  editors: PersonRef[];
  documents: number;
  canEdit: boolean;
}
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
  description?: string;
  expiresOn?: string | null;
  remindDays: number;
  latest: Version | null;
  versions: Version[];
  canEdit: boolean;
}
interface DocList {
  folder: { _id: string; name: string; description?: string };
  items: Doc[];
  canEdit: boolean;
  maxBytes: number;
  allowed: string[];
}
interface Expiring {
  _id: string;
  title: string;
  folder: { _id: string; name: string };
  expiresOn: string;
  overdue: boolean;
}

const rawUpload = (url: string, file: File, params: Record<string, string | number | undefined>) =>
  api.post(url, file, { params, headers: { 'Content-Type': file.type || 'application/octet-stream' }, transformRequest: [(d) => d] });

function problem(f: File, allowed: string[], maxBytes: number) {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
  if (!allowed.includes(ext)) return `.${ext || '?'} files are not allowed`;
  if (!f.size) return 'The file is empty';
  if (f.size > maxBytes) return `The file is ${fmtSize(f.size)}; the limit is ${fmtSize(maxBytes)}`;
  return null;
}

function ExpiryTag({ date, remindDays }: { date?: string | null; remindDays: number }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const today = dayjs().format('YYYY-MM-DD');
  const past = date < today;
  const soon = !past && dayjs(date).subtract(remindDays, 'day').format('YYYY-MM-DD') <= today;
  return <span className={cn(past && 'font-medium text-red-600', soon && 'font-medium text-amber-700')}>{dayjs(date).format('DD MMM YYYY')}{past ? ' (expired)' : soon ? ' (due soon)' : ''}</span>;
}

export function ConfidentialPage() {
  const [params, setParams] = useSearchParams();
  const folders = useGet<{ items: FolderRow[]; canManage: boolean }>(['confidential', 'folders'], '/confidential/folders');
  const expiring = useGet<Expiring[]>(['confidential', 'expiring'], '/confidential/expiring');
  const [folderDialog, setFolderDialog] = useState<FolderRow | 'new' | null>(null);
  const items = folders.data?.items ?? [];
  const selected = params.get('folder') ?? items[0]?._id ?? '';
  const delFolder = useSend<string>('delete', (fid) => `/confidential/folders/${fid}`, { invalidate: [['confidential']], success: 'Folder deleted', onSuccess: () => setParams({}) });

  return (
    <>
      <PageHeader
        title="Confidential documents"
        description="Restricted to Admin, Management and HR. Every download is logged."
        actions={
          folders.data?.canManage && (
            <Button onClick={() => setFolderDialog('new')}>
              <FolderPlus /> New folder
            </Button>
          )
        }
      />
      {!!expiring.data?.length && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="p-4 text-sm">
            <div className="mb-1 flex items-center gap-2 font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4" /> Due for renewal or review
            </div>
            {expiring.data.map((e) => (
              <button key={e._id} className="block text-left hover:underline" onClick={() => setParams({ folder: e.folder._id })}>
                {e.title} <span className="text-muted-foreground">· {e.folder.name} ·</span> <span className={e.overdue ? 'font-medium text-red-600' : ''}>{e.overdue ? 'expired' : 'due'} {dayjs(e.expiresOn).format('DD MMM YYYY')}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Folders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2 pt-0">
            {!items.length && <p className="px-2 py-1 text-sm text-muted-foreground">{folders.data?.canManage ? 'Create a folder to start, e.g. Legal, Finance, HR records.' : 'No folders yet.'}</p>}
            {items.map((f) => (
              <div key={f._id} className={cn('group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm', f._id === selected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-accent')}>
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setParams({ folder: f._id })}>
                  <Folder className="h-4 w-4 shrink-0" /> <span className="truncate">{f.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{f.documents}</span>
                </button>
                {folders.data?.canManage && (
                  <span className="hidden gap-1 group-hover:flex">
                    <button aria-label="Edit folder" onClick={() => setFolderDialog(f)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button aria-label="Delete folder" onClick={() => window.confirm(`Delete folder "${f.name}"? It must be empty.`) && delFolder.mutate(f._id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        {selected ? <FolderDocs folderId={selected} folder={items.find((f) => f._id === selected)} /> : <div />}
      </div>
      <FolderDialog editing={folderDialog} onClose={() => setFolderDialog(null)} />
    </>
  );
}

function FolderDocs({ folderId, folder }: { folderId: string; folder?: FolderRow }) {
  const [view, setView] = useViewMode('confidential');
  const { data } = useGet<DocList>(['confidential', 'docs', folderId], `/confidential/folders/${folderId}/documents`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [versionOf, setVersionOf] = useState<Doc | null>(null);
  const [logOf, setLogOf] = useState<Doc | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const del = useSend<string>('delete', (docId) => `/confidential/documents/${docId}`, { invalidate: [['confidential']], success: 'Document deleted' });
  if (!data) return null;
  const dl = (d: Doc, v: Version) => downloadFile(`/confidential/documents/${d._id}/versions/${v._id}`, v.name);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Lock className="h-4 w-4" /> {data.folder.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {data.folder.description ? `${data.folder.description} · ` : ''}Editors: {folder?.editors.map((e) => e.name).join(', ') || 'Management only'}
          </p>
        </div>
        {data.canEdit && (
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
                  <TH>Latest file</TH>
                  <TH>Version</TH>
                  <TH>Renewal / expiry</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {!data.items.length && <EmptyRow cols={6} text="No documents in this folder." />}
                {data.items.map((d) => (
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
                      </TD>
                      <TD className="text-xs">
                        {d.latest && (
                          <>
                            <div className="max-w-[14rem] truncate">{d.latest.name}</div>
                            <div className="text-muted-foreground">
                              {fmtSize(d.latest.size)} · {d.latest.uploadedByName} · {dayjs(d.latest.at).format('DD MMM YYYY')}
                            </div>
                          </>
                        )}
                      </TD>
                      <TD>v{d.latest?.version}</TD>
                      <TD className="text-sm">
                        <ExpiryTag date={d.expiresOn} remindDays={d.remindDays} />
                      </TD>
                      <TD className="whitespace-nowrap text-right">
                        {d.latest && (
                          <Button size="icon" variant="ghost" aria-label="Download" title="Download (logged)" onClick={() => dl(d, d.latest!)}>
                            <Download />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" aria-label="Access log" title="Who opened it" onClick={() => setLogOf(d)}>
                          <Eye />
                        </Button>
                        {d.canEdit && (
                          <>
                            <Button size="icon" variant="ghost" aria-label="New version" title="Upload a new version" onClick={() => setVersionOf(d)}>
                              <FileUp />
                            </Button>
                            <Button size="icon" variant="ghost" aria-label="Edit" title="Edit details" onClick={() => setEditing(d)}>
                              <Pencil />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-destructive" aria-label="Delete" onClick={() => window.confirm(`Delete "${d.title}" and all its versions? The access log is kept.`) && del.mutate(d._id)}>
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </TD>
                    </TR>
                    {open[d._id] &&
                      d.versions.map((v) => (
                        <TR key={v._id} className="bg-muted/30 text-xs">
                          <TD />
                          <TD className="pl-6">
                            <History className="mr-1 inline h-3 w-3" /> v{v.version} {v.note && <span className="text-muted-foreground">— {v.note}</span>}
                          </TD>
                          <TD>
                            {v.name} · {fmtSize(v.size)}
                          </TD>
                          <TD colSpan={2}>
                            {dayjs(v.at).format('DD MMM YYYY HH:mm')} · {v.uploadedByName}
                          </TD>
                          <TD className="text-right">
                            <Button size="icon" variant="ghost" aria-label={`Download version ${v.version}`} onClick={() => dl(d, v)}>
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
          items={data.items}
          empty="No documents in this folder."
          render={(d) => (
            <Card key={d._id}>
              <CardContent className="space-y-2 p-4">
                <div className="truncate font-medium">{d.title}</div>
                {d.description && <div className="line-clamp-2 text-xs text-muted-foreground">{d.description}</div>}
                {d.latest && <CardLine label="File">{d.latest.name} · v{d.latest.version}</CardLine>}
                {d.latest && <CardLine label="Updated">{dayjs(d.latest.at).format('DD MMM YYYY')} · {d.latest.uploadedByName}</CardLine>}
                <CardLine label="Renewal / expiry"><ExpiryTag date={d.expiresOn} remindDays={d.remindDays} /></CardLine>
                <div className="flex justify-end gap-1 border-t pt-2">
                  {d.latest && <Button size="icon" variant="ghost" aria-label="Download" onClick={() => dl(d, d.latest!)}><Download /></Button>}
                  <Button size="icon" variant="ghost" aria-label="Access log" onClick={() => setLogOf(d)}><Eye /></Button>
                  {d.canEdit && <Button size="icon" variant="ghost" aria-label="New version" onClick={() => setVersionOf(d)}><FileUp /></Button>}
                  {d.canEdit && <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(d)}><Pencil /></Button>}
                  {d.canEdit && <Button size="icon" variant="ghost" className="text-destructive" aria-label="Delete" onClick={() => window.confirm(`Delete "${d.title}" and all its versions? The access log is kept.`) && del.mutate(d._id)}><Trash2 /></Button>}
                </div>
              </CardContent>
            </Card>
          )}
        />
        )}
      </>
      <DocDialog folderId={folderId} list={data} open={adding} onClose={() => setAdding(false)} />
      <DocDialog folderId={folderId} list={data} open={!!editing} editing={editing} onClose={() => setEditing(null)} />
      <VersionDialog list={data} doc={versionOf} onClose={() => setVersionOf(null)} />
      <AccessLog doc={logOf} onClose={() => setLogOf(null)} />
    </div>
  );
}

function FolderDialog({ editing, onClose }: { editing: FolderRow | 'new' | null; onClose: () => void }) {
  const existing = typeof editing === 'object' && editing ? editing : null;
  const people = useGet<PersonRef[]>(['confidential', 'people'], '/confidential/people', undefined, !!editing);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editors, setEditors] = useState<string[]>([]);
  const [last, setLast] = useState<typeof editing>(null);
  if (editing !== last) {
    setLast(editing);
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setEditors(existing?.editors.map((e) => e._id) ?? []);
  }
  const save = useSend(existing ? 'put' : 'post', existing ? `/confidential/folders/${existing._id}` : '/confidential/folders', {
    invalidate: [['confidential']],
    success: 'Saved',
    onSuccess: onClose,
    body: () => ({ name, description, editors }),
  });
  const byId = new Map((people.data ?? []).map((p) => [p._id, p]));
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit folder' : 'New confidential folder'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Legal, Finance, Board, HR records" />
          </Field>
          <Field label="Description (optional)">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Editors (can upload, change and delete here)">
            <div className="flex flex-wrap gap-1.5">
              {editors.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {byId.get(id)?.name ?? existing?.editors.find((e) => e._id === id)?.name ?? '…'}
                  <button type="button" aria-label="Remove" onClick={() => setEditors(editors.filter((x) => x !== id))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <Select className="mt-1.5" value="" onChange={(e) => e.target.value && setEditors([...new Set([...editors, e.target.value])])}>
              <option value="">Add an editor…</option>
              <PersonOptions people={(people.data ?? []).filter((p) => !editors.includes(p._id))} label={(p) => `${p.name}${p.designation ? ` · ${p.designation}` : ''}`} />
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">Management (and Admin) can always edit. Everyone in Admin, Management and HR can view and download.</p>
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || name.trim().length < 2} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocDialog({ folderId, list, open, editing, onClose }: { folderId: string; list: DocList; open: boolean; editing?: Doc | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [remindDays, setRemindDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(false);
  if (open !== last) {
    setLast(open);
    if (open) {
      setFile(null);
      setTitle(editing?.title ?? '');
      setDescription(editing?.description ?? '');
      setExpiresOn(editing?.expiresOn ?? '');
      setRemindDays(editing?.remindDays ?? 30);
    }
  }
  async function save() {
    setBusy(true);
    try {
      if (editing) {
        await api.put(`/confidential/documents/${editing._id}`, { title, description, expiresOn: expiresOn || null, remindDays });
      } else {
        if (!file) return;
        const bad = problem(file, list.allowed, list.maxBytes);
        if (bad) return void toast.error(bad);
        await rawUpload(`/confidential/folders/${folderId}/documents`, file, { name: file.name, title, description: description || undefined, expiresOn: expiresOn || undefined, remindDays });
      }
      toast.success(editing ? 'Saved' : 'Document added');
      qc.invalidateQueries({ queryKey: ['confidential'] });
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
          <DialogTitle>{editing ? 'Edit document' : `Add to ${list.folder.name}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!editing && (
            <Field label="File">
              <input
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
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description (optional)">
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Renewal / expiry date (optional)">
              <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </Field>
            <Field label="Remind this many days before">
              <Input type="number" min={1} max={365} value={remindDays} disabled={!expiresOn} onChange={(e) => setRemindDays(Number(e.target.value) || 30)} />
            </Field>
          </div>
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

function VersionDialog({ list, doc, onClose }: { list: DocList; doc: Doc | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<Doc | null>(null);
  if (doc !== last) {
    setLast(doc);
    setFile(null);
    setNote('');
  }
  async function save() {
    if (!doc || !file) return;
    const bad = problem(file, list.allowed, list.maxBytes);
    if (bad) return void toast.error(bad);
    setBusy(true);
    try {
      await rawUpload(`/confidential/documents/${doc._id}/versions`, file, { name: file.name, note: note || undefined });
      toast.success('New version uploaded');
      qc.invalidateQueries({ queryKey: ['confidential'] });
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
          <Field label="File">
            <input type="file" accept={list.allowed.map((e) => `.${e}`).join(',')} className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="What changed (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Renewed for 2027" />
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

function AccessLog({ doc, onClose }: { doc: Doc | null; onClose: () => void }) {
  const { data } = useGet<{ _id: string; version: number; userName?: string; ip?: string; at: string }[]>(['confidential', 'access', doc?._id], `/confidential/documents/${doc?._id}/access`, undefined, !!doc);
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Who opened "{doc?.title}"</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto text-sm">
          {!data?.length && <p className="text-muted-foreground">Nobody has downloaded it yet.</p>}
          {data?.map((a) => (
            <div key={a._id} className="flex justify-between border-b py-1.5">
              <span>
                {a.userName ?? 'Someone'} <span className="text-xs text-muted-foreground">· v{a.version}</span>
              </span>
              <span className="text-xs text-muted-foreground">{dayjs(a.at).format('DD MMM YYYY HH:mm')}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
