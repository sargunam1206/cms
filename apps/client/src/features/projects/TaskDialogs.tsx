import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { useGet, useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { PendingFiles, TaskFiles, uploadAll } from './TaskFiles';
import { toast } from 'sonner';
import { fmtDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { PRIORITIES, TASK_STATUSES, isOverdue, priorityLabel, statusLabel, type ProjectDetail, type TaskRow } from './types';
import { PersonOptions } from '@/components/common/PersonOptions';

const PRIORITY_VARIANT: Record<string, 'secondary' | 'default' | 'warning' | 'destructive'> = { low: 'secondary', medium: 'default', high: 'warning', urgent: 'destructive' };
export const PriorityBadge = ({ priority }: { priority: string }) => <Badge variant={PRIORITY_VARIANT[priority] ?? 'secondary'}>{priorityLabel(priority)}</Badge>;

const BLANK = { title: '', description: '', assignee: '', status: 'todo', priority: 'medium', estimateHours: '', dueDate: '', milestone: '', estimateModule: '' };

/**
 * Create or edit a task. Managers pick anyone in the team; a team member can only leave it as it is, or take an
 * unassigned task themselves (the server enforces the same rule).
 */
export function TaskFormDialog({ project, task, open, onClose, defaultStatus }: { project: ProjectDetail; task: TaskRow | null; open: boolean; onClose: () => void; defaultStatus?: string }) {
  const [f, setF] = useState(BLANK);
  const [pending, setPending] = useState<File[]>([]);
  useEffect(() => {
    if (!open) return;
    setPending([]);
    if (task) setF({ title: task.title, description: task.description ?? '', assignee: task.assignee?._id ?? '', status: task.status, priority: task.priority, estimateHours: task.estimateHours != null ? String(task.estimateHours) : '', dueDate: task.dueDate ?? '', milestone: task.milestone ?? '', estimateModule: task.estimateModule ?? '' });
    else setF({ ...BLANK, status: defaultStatus ?? 'todo' });
  }, [open, task, defaultStatus]);
  const { user } = useAuth();
  const me = user?.employee?._id;
  const allTeam = [project.manager, ...project.members.filter((m) => m._id !== project.manager._id)];
  const current = task?.assignee?._id ?? '';
  const team = project.canManage ? allTeam : allTeam.filter((m) => m._id === current || (!current && m._id === me));
  const lockAssignee = !project.canManage && !!current;
  const milestones = useGet<{ items: { _id: string; name: string }[] }>(['milestones', project._id], `/milestones/project/${project._id}`, undefined, open);
  const modules = useGet<string[]>(['estimates', 'modules', project._id], `/estimates/project/${project._id}/modules`, undefined, open);
  const save = useSend<void, { _id: string }>(task ? 'put' : 'post', task ? `/projects/tasks/${task._id}` : `/projects/${project._id}/tasks`, {
    invalidate: [['projects']],
    success: task ? 'Task updated' : 'Task created',
    body: () => ({ ...f, assignee: f.assignee || null, milestone: f.milestone || null, estimateModule: f.estimateModule || null, estimateHours: f.estimateHours ? Number(f.estimateHours) : undefined }),
    onSuccess: async (r) => {
      // a new task has no id until it is saved, so files chosen in the form are attached now
      if (!task && pending.length) {
        const n = await uploadAll(r._id, pending);
        if (n) toast.success(n === 1 ? 'File attached' : `${n} files attached`);
      }
      onClose();
    },
  });
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? `Edit ${task.ref}` : 'New task'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2">
            <Input value={f.title} onChange={set('title')} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={3} value={f.description} onChange={set('description')} />
          </Field>
          <Field label="Assignee">
            <Select value={f.assignee} onChange={set('assignee')} disabled={lockAssignee} title={lockAssignee ? 'Only the project manager can reassign' : undefined}>
              {!lockAssignee && <option value="">Unassigned</option>}
              <PersonOptions people={team} label={(m) => m.name} />
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={set('status')}>
              {TASK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estimate (hours)">
            <Input type="number" min={0} step="0.5" value={f.estimateHours} onChange={set('estimateHours')} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={f.dueDate} onChange={set('dueDate')} />
          </Field>
          {!!modules.data?.length && (
            <Field label="Estimate module" className="sm:col-span-2">
              <Select value={f.estimateModule} onChange={set('estimateModule')}>
                <option value="">None</option>
                {modules.data.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
          )}
          {!!milestones.data?.items.length && (
            <Field label="Milestone" className="sm:col-span-2">
              <Select value={f.milestone} onChange={set('milestone')}>
                <option value="">None</option>
                {milestones.data.items.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Attachments</span>
            {task ? <TaskFiles taskId={task._id} /> : <PendingFiles files={pending} onChange={setPending} />}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || f.title.trim().length < 2} onClick={() => save.mutate(undefined)}>
            Save task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A task's details: change its status (assignee or manager), read and add comments, and for managers edit or delete.
 * It loads the task itself, so it works from the board, the list and "My tasks".
 */
export function TaskDetailDialog({ taskId, onClose, onEdit }: { taskId: string | null; onClose: () => void; onEdit?: (t: TaskRow) => void }) {
  const { data } = useGet<TaskRow>(['projects', 'task', taskId], `/projects/tasks/${taskId}`, undefined, !!taskId);
  // without an onEdit from the page (e.g. My tasks), the dialog edits the task itself, loading its project for the form
  const [selfEdit, setSelfEdit] = useState<TaskRow | null>(null);
  const project = useGet<ProjectDetail>(['projects', 'detail', selfEdit?.project?._id], `/projects/${selfEdit?.project?._id}`, undefined, !!selfEdit?.project?._id);
  const [text, setText] = useState('');
  useEffect(() => setText(''), [taskId]);
  const inv = { invalidate: [['projects']] };
  const move = useSend<string>('post', `/projects/tasks/${taskId}/status`, { ...inv, success: 'Status updated', body: (status) => ({ status }) });
  const comment = useSend('post', `/projects/tasks/${taskId}/comments`, { ...inv, body: () => ({ text }), onSuccess: () => setText('') });
  const del = useSend<void>('delete', `/projects/tasks/${taskId}`, { ...inv, success: 'Task deleted', onSuccess: onClose });
  const today = dayjs().format('YYYY-MM-DD');
  const canMove = !!data && (data.canManage || data.isAssignee);

  return (
    <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {data && (
          <>
            <DialogHeader>
              <DialogTitle>
                <span className="mr-2 font-mono text-sm text-muted-foreground">{data.ref}</span>
                {data.title}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <PriorityBadge priority={data.priority} />
              <Badge variant="outline">{statusLabel(data.status)}</Badge>
              {isOverdue(data, today) && <Badge variant="destructive">Overdue</Badge>}
              {data.project && <span className="text-muted-foreground">in {data.project.name}</span>}
            </div>
            {data.description && <p className="whitespace-pre-wrap text-sm">{data.description}</p>}
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Assignee</dt>
                <dd className="font-medium">{data.assignee?.name ?? 'Unassigned'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Due</dt>
                <dd className="font-medium">{fmtDate(data.dueDate)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Estimate</dt>
                <dd className="font-medium">{data.estimateHours != null ? `${data.estimateHours} h` : '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Select value={data.status} disabled={!canMove || move.isPending} onChange={(e) => move.mutate(e.target.value)} aria-label="Change status" className="h-8">
                    {TASK_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </dd>
              </div>
            </dl>

            <TaskFiles taskId={data._id} />

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Comments ({data.comments?.length ?? 0})</h4>
              {data.comments?.map((c) => (
                <div key={c._id} className="rounded-md border p-2 text-sm">
                  <div className="text-xs text-muted-foreground">
                    {c.byName} · {dayjs(c.at).format('DD MMM, hh:mm A')}
                  </div>
                  <div className="whitespace-pre-wrap">{c.text}</div>
                </div>
              ))}
              <div className="flex gap-2">
                <Input placeholder="Write a comment" value={text} onChange={(e) => setText(e.target.value)} aria-label="Comment" />
                <Button disabled={!text.trim() || comment.isPending} onClick={() => comment.mutate(undefined)}>
                  Post
                </Button>
              </div>
            </section>

            {(data.canManage || data.canEdit) && (
              <DialogFooter>
                {data.canManage && (
                  <Button variant="ghost" onClick={() => confirm('Delete this task?') && del.mutate(undefined)}>
                    Delete
                  </Button>
                )}
                {(data.canEdit || data.canManage) && (
                  <Button variant="outline" onClick={() => (onEdit ? onEdit(data) : setSelfEdit(data))}>
                    Edit
                  </Button>
                )}
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
      {project.data && selfEdit && <TaskFormDialog project={project.data} task={selfEdit} open onClose={() => setSelfEdit(null)} />}
    </Dialog>
  );
}
