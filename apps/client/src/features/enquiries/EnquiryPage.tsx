import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FolderPlus, Pencil, Repeat } from 'lucide-react';
import { useGet, useSend } from '@/api/hooks';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import type { Person } from '@/features/projects/types';
import { EnquiryForm } from './EnquiryForm';
import { FollowUp, StatusBadge } from './EnquiriesPage';
import { isClosed, type EnquiryDetail, type Options } from './types';

const tomorrow = () => dayjs().add(1, 'day').format('YYYY-MM-DD');
const KIND: Record<string, string> = { created: 'Started', note: 'Note', status: 'Status', followup: 'Follow-up', owner: 'Owner', edit: 'Edited', converted: 'Converted' };

export function EnquiryPage() {
  const { id } = useParams();
  const { data: e, isError } = useGet<EnquiryDetail>(['enquiries', 'detail', id], `/enquiries/${id}`);
  const options = useGet<Options>(['enquiries', 'options'], '/enquiries/options');
  const [dialog, setDialog] = useState<'edit' | 'status' | 'convert' | null>(null);
  const [note, setNote] = useState('');
  const [noteDate, setNoteDate] = useState('');
  const addNote = useSend<void>('post', `/enquiries/${id}/notes`, {
    invalidate: [['enquiries']],
    success: 'Note added',
    body: () => ({ text: note, ...(noteDate ? { nextFollowUp: noteDate } : {}) }),
    onSuccess: () => {
      setNote('');
      setNoteDate('');
    },
  });
  const del = useSend<void>('delete', `/enquiries/${id}`, { invalidate: [['enquiries']], success: 'Enquiry deleted', onSuccess: () => history.back() });
  const o = options.data;

  if (isError)
    return (
      <div className="py-20 text-center text-muted-foreground">
        This enquiry does not exist, or it belongs to someone else.{' '}
        <Link to="/enquiries" className="text-primary underline">
          Back to enquiries
        </Link>
      </div>
    );
  if (!e || !o) return <Spinner />;
  const closed = isClosed(o, e.status);

  return (
    <>
      <Link to="/enquiries" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All enquiries
      </Link>
      <PageHeader
        title={e.name}
        description={[e.company, e.phone, e.email].filter(Boolean).join(' · ')}
        actions={
          <>
            <StatusBadge status={e.status} o={o} />
            {e.canWrite && (
              <>
                <Button variant="outline" onClick={() => setDialog('edit')}>
                  <Pencil /> Edit
                </Button>
                {!e.project && (
                  <Button variant="outline" onClick={() => setDialog('status')}>
                    <Repeat /> Change status
                  </Button>
                )}
              </>
            )}
            {e.canConvert && (
              <Button onClick={() => setDialog('convert')}>
                <FolderPlus /> Convert to project
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Owner" value={e.owner?.name} />
            <Row label="Source" value={e.source} />
            {!closed && <Row label="Next follow-up" value={<FollowUp e={e} />} />}
            {e.lostReason && <Row label="Lost because" value={e.lostReason} />}
            {e.client && <Row label="Client" value={e.client.name} />}
            {e.project && (
              <Row
                label="Project"
                value={
                  <Link className="text-primary underline" to={`/projects/${e.project._id}`}>
                    {e.project.code} {e.project.name}
                  </Link>
                }
              />
            )}
            {e.canWrite && !e.project && (
              <Button variant="ghost" size="sm" className="text-red-700" onClick={() => confirm('Delete this enquiry?') && del.mutate(undefined)}>
                Delete enquiry
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {e.canWrite && (
            <Card>
              <CardContent className="space-y-3 pt-5">
                <Field label="Add a note">
                  <Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What was discussed?" />
                </Field>
                <div className="flex flex-wrap items-end gap-3">
                  {!closed && (
                    <Field label="Move follow-up to (optional)">
                      <Input type="date" className="w-44" min={dayjs().format('YYYY-MM-DD')} value={noteDate} onChange={(ev) => setNoteDate(ev.target.value)} />
                    </Field>
                  )}
                  <Button disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate(undefined)}>
                    Add note
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {[...e.activity].reverse().map((a) => (
                  <li key={a._id} className="flex gap-3 text-sm">
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">
                      {dayjs(a.at).format('DD MMM, hh:mm A')}
                    </span>
                    <span>
                      <span className="font-medium">{KIND[a.kind]}</span> <span className="text-muted-foreground">· {a.byName}</span>
                      {a.text && <span className="block whitespace-pre-wrap">{a.text}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>

      <EnquiryForm open={dialog === 'edit'} enquiry={e} onClose={() => setDialog(null)} />
      <StatusDialog open={dialog === 'status'} e={e} o={o} onClose={() => setDialog(null)} />
      <ConvertDialog open={dialog === 'convert'} e={e} onClose={() => setDialog(null)} />
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function StatusDialog({ open, e, o, onClose }: { open: boolean; e: EnquiryDetail; o: Options; onClose: () => void }) {
  const [status, setStatus] = useState(e.status);
  const [lostReason, setLostReason] = useState('');
  const [next, setNext] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setStatus(e.status);
    setLostReason('');
    setNext(e.nextFollowUp && e.nextFollowUp >= dayjs().format('YYYY-MM-DD') ? e.nextFollowUp : tomorrow());
    setNote('');
  }, [open, e]);
  const save = useSend<void>('post', `/enquiries/${e._id}/status`, {
    invalidate: [['enquiries']],
    success: 'Status updated',
    body: () => ({ status, note, ...(status === o.lost ? { lostReason } : {}), ...(!isClosed(o, status) ? { nextFollowUp: next } : {}) }),
    onSuccess: onClose,
  });
  const open_ = !isClosed(o, status);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Status">
            <Select value={status} onChange={(ev) => setStatus(ev.target.value)}>
              {[...o.stages, o.won, o.lost].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          {status === o.lost && (
            <Field label="Why was it lost?">
              <Select value={lostReason} onChange={(ev) => setLostReason(ev.target.value)}>
                <option value="">Choose…</option>
                {o.lostReasons.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
          )}
          {open_ && (
            <Field label="Next follow-up">
              <Input type="date" min={dayjs().format('YYYY-MM-DD')} value={next} onChange={(ev) => setNext(ev.target.value)} />
            </Field>
          )}
          <Field label="Note (optional)">
            <Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || status === e.status || (status === o.lost && !lostReason) || (open_ && !next)} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ open, e, onClose }: { open: boolean; e: EnquiryDetail; onClose: () => void }) {
  const people = useGet<Person[]>(['projects', 'people'], '/projects/people', undefined, open);
  const [f, setF] = useState({ projectCode: '', projectName: '', manager: '', billingType: 'time_material' });
  useEffect(() => {
    if (open) setF({ projectCode: '', projectName: e.company ? `${e.company} project` : `${e.name} project`, manager: '', billingType: 'time_material' });
  }, [open, e]);
  const save = useSend<void>('post', `/enquiries/${e._id}/convert`, { invalidate: [['enquiries'], ['projects']], success: 'Project created', body: () => f, onSuccess: onClose });
  const set = (k: keyof typeof f) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: ev.target.value });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert to project</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Creates {e.company || e.name} as a client (or uses the one with that name) and starts a project for them.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project code">
            <Input placeholder="PRJ-001" value={f.projectCode} onChange={set('projectCode')} />
          </Field>
          <Field label="Billing">
            <Select value={f.billingType} onChange={set('billingType')}>
              <option value="time_material">Time and material</option>
              <option value="fixed">Fixed price</option>
              <option value="internal">Internal</option>
            </Select>
          </Field>
          <Field label="Project name" className="sm:col-span-2">
            <Input value={f.projectName} onChange={set('projectName')} />
          </Field>
          <Field label="Project manager" className="sm:col-span-2">
            <Select value={f.manager} onChange={set('manager')}>
              <option value="">Choose…</option>
              {people.data?.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || !f.projectCode || f.projectName.trim().length < 2 || !f.manager} onClick={() => save.mutate(undefined)}>
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
