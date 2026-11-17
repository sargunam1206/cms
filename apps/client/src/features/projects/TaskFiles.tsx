import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/api/client';
import { useGet, useSend } from '@/api/hooks';
import { downloadFile } from '@/lib/download';
import { Button } from '@/components/ui/button';

export const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'xlsx', 'xls', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'txt'];
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
export const ACCEPT = ALLOWED_EXT.map((e) => `.${e}`).join(',');
const HINT = 'PDF, images, Excel, CSV, Word, PowerPoint or text · up to 10 MB each · up to 10 files per task';

export const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** Why a chosen file cannot be attached, or null when it can. */
export function fileProblem(f: File) {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
  if (!ALLOWED_EXT.includes(ext)) return `"${f.name}": .${ext || '?'} files are not allowed`;
  if (f.size === 0) return `"${f.name}" is empty`;
  if (f.size > MAX_BYTES) return `"${f.name}" is ${fmtSize(f.size)}; the limit is 10 MB`;
  return null;
}

export async function uploadTaskFile(taskId: string, file: File) {
  await api.post(`/projects/tasks/${taskId}/files`, file, { params: { name: file.name }, headers: { 'Content-Type': file.type || 'application/octet-stream' }, transformRequest: [(d) => d] });
}

/** Uploads one after another; returns how many went through. Problems are shown as they happen. */
export async function uploadAll(taskId: string, files: File[]) {
  let done = 0;
  for (const f of files) {
    try {
      await uploadTaskFile(taskId, f);
      done++;
    } catch (e) {
      toast.error(`${f.name}: ${apiError(e)}`);
    }
  }
  return done;
}

interface FilesData {
  canUpload: boolean;
  items: { _id: string; name: string; size: number; uploadedByName?: string; canDelete: boolean }[];
}

/** The files on an existing task: download, remove, and add more (if you are allowed to). */
export function TaskFiles({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const { data } = useGet<FilesData>(['projects', 'files', taskId], `/projects/tasks/${taskId}/files`);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const remove = useSend<string>('delete', (fid) => `/projects/tasks/${taskId}/files/${fid}`, { invalidate: [['projects', 'files']], success: 'File removed' });
  if (!data) return null;
  if (!data.items.length && !data.canUpload) return null;

  async function pick(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const bad = files.map(fileProblem).find(Boolean);
    if (bad) return void toast.error(bad);
    if (data!.items.length + files.length > MAX_FILES) return void toast.error(`A task can have at most ${MAX_FILES} files`);
    setBusy(true);
    const n = await uploadAll(taskId, files);
    setBusy(false);
    if (input.current) input.current.value = '';
    if (n) toast.success(n === 1 ? 'File attached' : `${n} files attached`);
    qc.invalidateQueries({ queryKey: ['projects', 'files'] });
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Files ({data.items.length})</h4>
        {data.canUpload && (
          <>
            <input ref={input} type="file" multiple hidden accept={ACCEPT} aria-label="Attach files" onChange={(e) => pick(e.target.files)} />
            <Button size="sm" variant="outline" disabled={busy || data.items.length >= MAX_FILES} onClick={() => input.current?.click()}>
              <Paperclip /> {busy ? 'Uploading…' : 'Attach files'}
            </Button>
          </>
        )}
      </div>
      {!data.items.length && <p className="text-xs text-muted-foreground">No files yet. {HINT}</p>}
      <ul className="space-y-1">
        {data.items.map((f) => (
          <li key={f._id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={f.name}>
              {f.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {fmtSize(f.size)}
              {f.uploadedByName && ` · ${f.uploadedByName}`}
            </span>
            <Button variant="ghost" size="icon" aria-label={`Download ${f.name}`} onClick={() => downloadFile(`/projects/tasks/${taskId}/files/${f._id}`, f.name)}>
              <Download />
            </Button>
            {f.canDelete && (
              <Button variant="ghost" size="icon" aria-label={`Remove ${f.name}`} onClick={() => confirm(`Remove ${f.name}?`) && remove.mutate(f._id)}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {data.canUpload && data.items.length > 0 && <p className="text-xs text-muted-foreground">{HINT}</p>}
    </div>
  );
}

/** Files chosen while creating a task; they are uploaded as soon as the task has been saved. */
export function PendingFiles({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  function add(list: FileList | null) {
    const picked = Array.from(list ?? []);
    for (const f of picked) {
      const bad = fileProblem(f);
      if (bad) return void toast.error(bad);
    }
    const next = [...files, ...picked];
    if (next.length > MAX_FILES) return void toast.error(`A task can have at most ${MAX_FILES} files`);
    onChange(next);
    if (input.current) input.current.value = '';
  }
  return (
    <div className="space-y-2">
      <input ref={input} type="file" multiple hidden accept={ACCEPT} aria-label="Attach files" onChange={(e) => add(e.target.files)} />
      <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
        <Paperclip /> Attach files
      </Button>
      <p className="text-xs text-muted-foreground">{HINT}</p>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(f.size)}</span>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${f.name} from the list`} onClick={() => onChange(files.filter((_, k) => k !== i))}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
