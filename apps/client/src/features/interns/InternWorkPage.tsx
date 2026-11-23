import { useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { CheckCircle2, Clock, Plus, RotateCcw, Send, Star } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { TASK_STATUS_LABEL, hm, type InternRow, type InternTaskRow } from './types';

const COLUMNS: InternTaskRow['status'][] = ['assigned', 'in_progress', 'redo', 'submitted', 'approved'];
const TONE: Record<InternTaskRow['status'], 'secondary' | 'default' | 'warning' | 'success' | 'destructive'> = {
  assigned: 'secondary',
  in_progress: 'default',
  submitted: 'warning',
  approved: 'success',
  redo: 'destructive',
};

/** Interns see their own work; mentors see their interns' (and can give and review work); HR sees everyone's. */
export function InternWorkPage() {
  const { can, user } = useAuth();
  const isIntern = user?.employee?.type === 'intern';
  const guide = can(P.INTERNS_MENTOR, P.INTERNS_MANAGE);
  const interns = useGet<{ items: InternRow[] }>(['interns', 'list', 'work'], '/interns', undefined, guide);
  const [intern, setIntern] = useState('');
  const me = useGet<{ startDate: string; endDate: string; mentor?: { name: string } | null; allocations: { project: { code: string; name: string } }[] }>(['interns', 'me'], '/interns/me', undefined, isIntern);
  const active = (interns.data?.items ?? []).filter((i) => ['onboarding', 'active'].includes(i.status));
  return (
    <>
      <PageHeader title="Intern work" description={isIntern ? 'Your tasks: log what you did each day, then submit for your mentor to review.' : 'Give interns tasks, follow their daily logs and review submitted work.'} />
      {isIntern && me.data && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap gap-x-6 gap-y-1 p-4 text-sm">
            <span>
              Internship: {dayjs(me.data.startDate).format('DD MMM YYYY')} – {dayjs(me.data.endDate).format('DD MMM YYYY')}
            </span>
            <span>Mentor: {me.data.mentor?.name ?? '—'}</span>
            {!!me.data.allocations.length && <span>Projects: {me.data.allocations.map((a) => a.project?.code).join(', ')}</span>}
            {user?.employee && (
              <Link to={`/interns/${user.employee._id}`} className="ml-auto text-primary hover:underline">
                My internship (onboarding, documents) →
              </Link>
            )}
          </CardContent>
        </Card>
      )}
      {guide && (
        <div className="mb-3">
          <Select className="w-64" value={intern} onChange={(e) => setIntern(e.target.value)}>
            <option value="">All my interns</option>
            {active.map((i) => (
              <option key={i._id} value={i._id}>
                {i.employee.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <InternWorkBoard internId={intern || undefined} canAssign={guide && !!intern} pickIntern={guide && !intern ? active : undefined} />
    </>
  );
}

/** The board itself; also embedded on an intern's profile (internId set). */
export function InternWorkBoard({ internId, canAssign, pickIntern }: { internId?: string; canAssign: boolean; pickIntern?: InternRow[] }) {
  const { data } = useGet<InternTaskRow[]>(['interns', 'work', internId ?? 'all'], '/interns/work', { intern: internId });
  const [assigning, setAssigning] = useState(false);
  const [logFor, setLogFor] = useState<InternTaskRow | null>(null);
  const [submitFor, setSubmitFor] = useState<InternTaskRow | null>(null);
  const [reviewFor, setReviewFor] = useState<InternTaskRow | null>(null);
  const [open, setOpen] = useState<InternTaskRow | null>(null);
  const start = useSend<string>('post', (tid) => `/interns/tasks/${tid}/status`, { invalidate: [['interns']], success: 'Started', body: () => ({ status: 'in_progress' }) });
  const today = dayjs().format('YYYY-MM-DD');
  const showAssign = canAssign || !!pickIntern?.length;
  return (
    <>
      {showAssign && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setAssigning(true)}>
            <Plus /> Give a task
          </Button>
        </div>
      )}
      <div className="grid gap-3 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = (data ?? []).filter((t) => t.status === col);
          return (
            <section key={col} className="rounded-lg bg-muted/40 p-2">
              <h3 className="mb-2 px-1 text-sm font-semibold">
                {TASK_STATUS_LABEL[col]} <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
              </h3>
              <div className="space-y-2">
                {items.map((t) => (
                  <Card key={t._id} className="cursor-pointer" onClick={() => setOpen(t)}>
                    <CardContent className="space-y-1 p-3 text-sm">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {!t.mine && `${t.intern.name} · `}
                        {t.kind === 'project' && t.project ? t.project.code : 'Learning'}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Clock className="h-3 w-3" /> {hm(t.loggedMinutes)}
                        {t.dueDate && <span className={cn(t.dueDate < today && !['approved', 'submitted'].includes(t.status) && 'font-medium text-red-600')}>· due {dayjs(t.dueDate).format('DD MMM')}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 pt-1" onClick={(e) => e.stopPropagation()}>
                        {t.mine && t.status === 'assigned' && (
                          <Button size="sm" variant="outline" onClick={() => start.mutate(t._id)}>
                            Start
                          </Button>
                        )}
                        {t.mine && t.status !== 'approved' && (
                          <Button size="sm" variant="outline" onClick={() => setLogFor(t)}>
                            <Clock /> Log
                          </Button>
                        )}
                        {t.mine && ['in_progress', 'redo'].includes(t.status) && (
                          <Button size="sm" onClick={() => setSubmitFor(t)}>
                            <Send /> Submit
                          </Button>
                        )}
                        {t.canReview && t.status === 'submitted' && (
                          <Button size="sm" onClick={() => setReviewFor(t)}>
                            Review
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {!data?.length && <p className="mt-3 text-sm text-muted-foreground">No intern tasks yet.</p>}
      <AssignDialog open={assigning} internId={internId} pickIntern={pickIntern} onClose={() => setAssigning(false)} />
      <LogDialog task={logFor} onClose={() => setLogFor(null)} />
      <SubmitDialog task={submitFor} onClose={() => setSubmitFor(null)} />
      <ReviewDialog task={reviewFor} onClose={() => setReviewFor(null)} />
      <TaskDetail task={open} onClose={() => setOpen(null)} />
    </>
  );
}

function AssignDialog({ open, internId, pickIntern, onClose }: { open: boolean; internId?: string; pickIntern?: InternRow[]; onClose: () => void }) {
  const [f, setF] = useState({ intern: '', title: '', description: '', kind: 'learning', project: '', dueDate: '', estimateHours: '' });
  const target = internId || f.intern;
  const intern = useGet<{ allocations: { project: { _id: string; code: string; name: string } }[] }>(['interns', 'one', target], `/interns/${target}`, undefined, open && !!target);
  const projects = intern.data?.allocations.map((a) => a.project).filter(Boolean) ?? [];
  const save = useSend('post', `/interns/${target}/tasks`, {
    invalidate: [['interns']],
    success: 'Task given',
    onSuccess: () => {
      setF({ ...f, title: '', description: '', dueDate: '', estimateHours: '' });
      onClose();
    },
    body: () => ({ title: f.title, description: f.description, kind: f.kind, project: f.kind === 'project' ? f.project || null : null, dueDate: f.dueDate || null, estimateHours: f.estimateHours ? Number(f.estimateHours) : undefined }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give a task</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!internId && (
            <Field label="Intern" className="sm:col-span-2">
              <Select value={f.intern} onChange={(e) => setF({ ...f, intern: e.target.value })}>
                <option value="">Choose…</option>
                {pickIntern?.map((i) => (
                  <option key={i._id} value={i._id}>
                    {i.employee.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Task" className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Learn React basics, Draw the bedroom elevation" />
          </Field>
          <Field label="Details" className="sm:col-span-2">
            <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <Field label="Kind">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="learning">Learning task</option>
              <option value="project">Project work</option>
            </Select>
          </Field>
          {f.kind === 'project' && (
            <Field label="Project">
              <Select value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}>
                <option value="">{projects.length ? 'Choose…' : 'Allocate a project first'}</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Due date">
            <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
          <Field label="Estimate (hours)">
            <Input type="number" min={0} value={f.estimateHours} onChange={(e) => setF({ ...f, estimateHours: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || !target || f.title.trim().length < 2} onClick={() => save.mutate(undefined)}>
            Give task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogDialog({ task, onClose }: { task: InternTaskRow | null; onClose: () => void }) {
  const [f, setF] = useState({ date: dayjs().format('YYYY-MM-DD'), hours: '1', minutes: '0', note: '' });
  const save = useSend('post', `/interns/tasks/${task?._id}/logs`, {
    invalidate: [['interns']],
    success: 'Logged',
    onSuccess: () => {
      setF({ ...f, note: '' });
      onClose();
    },
    body: () => ({ date: f.date, minutes: (Number(f.hours) || 0) * 60 + (Number(f.minutes) || 0), note: f.note }),
  });
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log work on "{task?.title}"</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">
            <Input type="date" max={dayjs().format('YYYY-MM-DD')} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Hours">
            <Input type="number" min={0} max={16} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          </Field>
          <Field label="Minutes">
            <Input type="number" min={0} max={59} step={5} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
          </Field>
          <Field label="What did you do?" className="col-span-3">
            <Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || f.note.trim().length < 2} onClick={() => save.mutate(undefined)}>
            Save log
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubmitDialog({ task, onClose }: { task: InternTaskRow | null; onClose: () => void }) {
  const [note, setNote] = useState('');
  const save = useSend('post', `/interns/tasks/${task?._id}/status`, { invalidate: [['interns']], success: 'Submitted for review', onSuccess: () => (setNote(''), onClose()), body: () => ({ status: 'submitted', note }) });
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Submit "{task?.title}" for review</DialogTitle>
        </DialogHeader>
        <Field label="Note for your mentor (optional)">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you finished, links, anything to check" />
        </Field>
        <DialogFooter>
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            <Send /> Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ task, onClose }: { task: InternTaskRow | null; onClose: () => void }) {
  const [rating, setRating] = useState(4);
  const [note, setNote] = useState('');
  const send = useSend<'approved' | 'redo'>('post', `/interns/tasks/${task?._id}/status`, {
    invalidate: [['interns']],
    success: 'Review saved',
    onSuccess: () => (setNote(''), onClose()),
    body: (status) => ({ status, note, rating: status === 'approved' ? rating : undefined }),
  });
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review "{task?.title}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="text-muted-foreground">
            {task?.intern.name} · {hm(task?.loggedMinutes ?? 0)} logged
          </div>
          {task?.submittedNote && <div className="rounded-md bg-muted p-2">“{task.submittedNote}”</div>}
          <Field label="Rating (if approving)">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-label={`${n} stars`} onClick={() => setRating(n)}>
                  <Star className={cn('h-5 w-5', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Feedback">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={send.isPending} onClick={() => send.mutate('redo')}>
            <RotateCcw /> Ask for a redo
          </Button>
          <Button disabled={send.isPending} onClick={() => send.mutate('approved')}>
            <CheckCircle2 /> Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetail({ task, onClose }: { task: InternTaskRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        {task && (
          <>
            <DialogHeader>
              <DialogTitle>{task.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Badge>
                <span className="text-muted-foreground">
                  {task.intern.name} · {task.kind === 'project' && task.project ? `${task.project.code} ${task.project.name}` : 'Learning task'} · given by {task.assignedByName}
                </span>
              </div>
              {task.description && <p className="whitespace-pre-wrap">{task.description}</p>}
              <Card>
                <CardHeader className="py-2">
                  <CardTitle className="text-sm">Daily log · {hm(task.loggedMinutes)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 pb-3">
                  {!task.logs.length && <p className="text-muted-foreground">Nothing logged yet.</p>}
                  {[...task.logs].reverse().map((l) => (
                    <div key={l._id}>
                      <span className="text-xs text-muted-foreground">
                        {dayjs(l.date).format('DD MMM')} · {hm(l.minutes)}
                      </span>{' '}
                      {l.note}
                    </div>
                  ))}
                </CardContent>
              </Card>
              {!!task.reviews.length && (
                <Card>
                  <CardHeader className="py-2">
                    <CardTitle className="text-sm">Reviews</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 pb-3">
                    {[...task.reviews].reverse().map((r) => (
                      <div key={r._id}>
                        <span className={r.outcome === 'approved' ? 'font-medium text-emerald-700' : 'font-medium text-red-700'}>{r.outcome === 'approved' ? 'Approved' : 'Redo'}</span>
                        {r.rating ? ` ${'★'.repeat(r.rating)}` : ''} <span className="text-xs text-muted-foreground">· {r.byName} · {dayjs(r.at).format('DD MMM')}</span>
                        {r.note && <div>{r.note}</div>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
