import { useEffect, useState } from 'react';
import { Flag, Plus, Trash2 } from 'lucide-react';
import { useGet, useSend } from '@/api/hooks';
import { fmtDate } from '@/lib/utils';
import { Spinner } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import type { EmployeeRef } from '@/api/types';
import { Gantt, Legend, STATE_LABEL, type MState, type Row } from './Gantt';

export interface MilestoneRow {
  _id: string;
  project?: string;
  name: string;
  description?: string;
  owner?: EmployeeRef | null;
  plannedStart: string;
  plannedEnd: string;
  baselineStart?: string | null;
  baselineEnd?: string | null;
  status: 'planned' | 'in_progress' | 'done';
  doneOn?: string | null;
  state: MState;
  slipDays: number | null;
  tasks: number;
  tasksDone: number;
}
interface Data {
  canEdit: boolean;
  baselineAt: string | null;
  today: string;
  items: MilestoneRow[];
  tasks: { _id: string; ref: string; title: string; status: string; dueDate?: string; milestone: string }[];
}

const slipText = (n: number | null) => (n == null ? '' : n === 0 ? 'on baseline' : n > 0 ? `${n} day${n === 1 ? '' : 's'} behind` : `${-n} day${n === -1 ? '' : 's'} ahead`);

export function TimelineTab({ projectId, members }: { projectId: string; members: EmployeeRef[] }) {
  const { data } = useGet<Data>(['milestones', projectId], `/milestones/project/${projectId}`);
  const [edit, setEdit] = useState<MilestoneRow | 'new' | null>(null);
  const [rebase, setRebase] = useState(false);
  const baseline = useSend<{ reason?: string }>('post', `/milestones/project/${projectId}/baseline`, { invalidate: [['milestones']], success: 'Baseline set', onSuccess: () => setRebase(false) });
  if (!data) return <Spinner />;

  const rows: Row[] = data.items.flatMap((m) => {
    const prog = m.tasks ? m.tasksDone / m.tasks : m.status === 'done' ? 1 : undefined;
    const tasks = data.tasks.filter((t) => t.milestone === m._id && t.dueDate);
    return [
      {
        id: m._id,
        label: m.name,
        sub: `${STATE_LABEL[m.state]}${m.slipDays ? ` · ${slipText(m.slipDays)}` : ''}`,
        onLabelClick: data.canEdit ? () => setEdit(m) : undefined,
        bars: [
          {
            id: m._id,
            start: m.plannedStart,
            end: m.plannedEnd,
            state: m.state,
            progress: prog,
            baseStart: m.baselineStart,
            baseEnd: m.baselineEnd,
            title: `${m.name}: ${fmtDate(m.plannedStart)} to ${fmtDate(m.plannedEnd)} · ${STATE_LABEL[m.state]}${m.tasks ? ` · ${m.tasksDone}/${m.tasks} tasks done` : ''}`,
            onClick: data.canEdit ? () => setEdit(m) : undefined,
          },
        ],
      },
      ...tasks.map((t) => ({
        id: t._id,
        label: `${t.ref} ${t.title}`,
        indent: true,
        bars: [],
        marks: [{ id: t._id, date: t.dueDate!, title: `${t.ref} ${t.title}, due ${fmtDate(t.dueDate)}`, done: t.status === 'done' }],
      })),
    ];
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {data.baselineAt ? <Badge variant="outline">Baseline set {fmtDate(data.baselineAt)}</Badge> : <Badge variant="outline">No baseline yet</Badge>}
        <div className="ml-auto flex gap-2">
          {data.canEdit && data.items.length > 0 && (
            <Button variant="outline" onClick={() => (data.baselineAt ? setRebase(true) : baseline.mutate({}))}>
              <Flag /> {data.baselineAt ? 'Reset baseline' : 'Set baseline'}
            </Button>
          )}
          {data.canEdit && (
            <Button onClick={() => setEdit('new')}>
              <Plus /> Add milestone
            </Button>
          )}
        </div>
      </div>
      {!data.items.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No milestones yet.{data.canEdit && ' Add the key dates for this project, then set the baseline to track slip.'}</CardContent>
        </Card>
      ) : (
        <>
          <Gantt rows={rows} today={data.today} />
          <Legend />
        </>
      )}
      <MilestoneDialog open={!!edit} milestone={edit === 'new' ? null : edit} projectId={projectId} members={members} onClose={() => setEdit(null)} />
      <Dialog open={rebase} onOpenChange={setRebase}>
        <ResetBaseline busy={baseline.isPending} onSave={(reason) => baseline.mutate({ reason })} />
      </Dialog>
    </div>
  );
}

function ResetBaseline({ onSave, busy }: { onSave: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Reset the baseline</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">The current planned dates become the new baseline and slip starts again from zero. The reason is recorded.</p>
      <Field label="Why is it being reset?">
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button disabled={!reason.trim() || busy} onClick={() => onSave(reason.trim())}>
          Reset baseline
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

const BLANK = { name: '', description: '', owner: '', plannedStart: '', plannedEnd: '', status: 'planned' };

function MilestoneDialog({ open, milestone, projectId, members, onClose }: { open: boolean; milestone: MilestoneRow | null; projectId: string; members: EmployeeRef[]; onClose: () => void }) {
  const [f, setF] = useState(BLANK);
  useEffect(() => {
    if (!open) return;
    setF(milestone ? { name: milestone.name, description: milestone.description ?? '', owner: milestone.owner?._id ?? '', plannedStart: milestone.plannedStart, plannedEnd: milestone.plannedEnd, status: milestone.status } : BLANK);
  }, [open, milestone]);
  const save = useSend(milestone ? 'put' : 'post', milestone ? `/milestones/${milestone._id}` : `/milestones/project/${projectId}`, {
    invalidate: [['milestones'], ['projects']],
    success: milestone ? 'Milestone updated' : 'Milestone added',
    body: () => ({ ...f, owner: f.owner || null }),
    onSuccess: onClose,
  });
  const remove = useSend('delete', milestone ? `/milestones/${milestone._id}` : '', { invalidate: [['milestones'], ['projects']], success: 'Milestone removed', onSuccess: onClose });
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{milestone ? 'Edit milestone' : 'Add milestone'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Starts">
            <Input type="date" value={f.plannedStart} onChange={set('plannedStart')} />
          </Field>
          <Field label="Ends">
            <Input type="date" value={f.plannedEnd} onChange={set('plannedEnd')} />
          </Field>
          <Field label="Owner">
            <Select value={f.owner} onChange={set('owner')}>
              <option value="">Project manager</option>
              {members.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={set('status')}>
              <option value="planned">Planned</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </Select>
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={2} value={f.description} onChange={set('description')} />
          </Field>
        </div>
        <DialogFooter>
          {milestone && (
            <Button variant="outline" className="mr-auto" disabled={remove.isPending} onClick={() => confirm('Remove this milestone? Its tasks stay, unlinked.') && remove.mutate(undefined)}>
              <Trash2 /> Remove
            </Button>
          )}
          <Button disabled={save.isPending || f.name.trim().length < 2 || !f.plannedStart || !f.plannedEnd} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
