import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ArrowLeft, Download, Plus, Trash2, Upload, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/api/client';
import { useGet, useSend } from '@/api/hooks';
import { downloadFile } from '@/lib/download';
import { PageHeader, Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fmtSize } from '@/features/projects/TaskFiles';
import { InternStatusBadge } from './InternsPage';
import { InternWorkBoard } from './InternWorkPage';
import { INTERN_STATUS_LABEL, inr, type InternDetail, type PersonRef } from './types';

export function InternPage() {
  const { id = '' } = useParams();
  const { data: i } = useGet<InternDetail>(['interns', 'one', id], `/interns/${id}`);
  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  if (!i) return <Spinner />;
  const closed = ['completed', 'dropped', 'converted'].includes(i.status);
  return (
    <>
      <Link to={i.isSelf ? '/intern-work' : '/interns'} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> {i.isSelf ? 'My work' : 'Interns'}
      </Link>
      <PageHeader
        title={i.employee.name}
        description={`${i.employee.code} · ${i.college}${i.course ? ` · ${i.course}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <InternStatusBadge status={i.status} />
            {i.canManage && (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Edit details
                </Button>
                <Button variant="outline" onClick={() => setStatusOpen(true)}>
                  Change status
                </Button>
                {i.status !== 'converted' && (
                  <Button onClick={() => setConvertOpen(true)}>
                    <UserCheck /> Convert to employee
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="onboarding">
            Onboarding ({i.checklist.filter((c) => c.done).length}/{i.checklist.length})
          </TabsTrigger>
          <TabsTrigger value="documents">Documents ({i.documents.length})</TabsTrigger>
          <TabsTrigger value="allocation">Projects</TabsTrigger>
          <TabsTrigger value="work">Work</TabsTrigger>
          {i.canManage && <TabsTrigger value="stipend">Stipend</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <Overview i={i} />
        </TabsContent>
        <TabsContent value="onboarding">
          <Onboarding i={i} />
        </TabsContent>
        <TabsContent value="documents">
          <Documents i={i} />
        </TabsContent>
        <TabsContent value="allocation">
          <Allocations i={i} closed={closed} />
        </TabsContent>
        <TabsContent value="work">
          <InternWorkBoard internId={i._id} canAssign={i.canGuide && !closed} />
        </TabsContent>
        {i.canManage && (
          <TabsContent value="stipend">
            <Stipend i={i} />
          </TabsContent>
        )}
      </Tabs>
      <EditIntern i={i} open={editing} onClose={() => setEditing(false)} />
      <StatusDialog i={i} open={statusOpen} onClose={() => setStatusOpen(false)} />
      <ConvertDialog i={i} open={convertOpen} onClose={() => setConvertOpen(false)} />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 border-b py-1.5 text-sm last:border-0">
      <div className="text-muted-foreground">{label}</div>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

function Overview({ i }: { i: InternDetail }) {
  const days = dayjs(i.endDate).diff(dayjs(i.startDate), 'day') + 1;
  const left = dayjs(i.endDate).diff(dayjs(), 'day');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Internship</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="Period">
            {dayjs(i.startDate).format('DD MMM YYYY')} – {dayjs(i.endDate).format('DD MMM YYYY')} ({days} days{['active', 'onboarding'].includes(i.status) && left >= 0 ? `, ${left} left` : ''})
          </Row>
          <Row label="Mentor">{i.mentor ? `${i.mentor.name}${i.mentor.designation ? ` · ${i.mentor.designation}` : ''}` : '—'}</Row>
          <Row label="College">{i.college}</Row>
          <Row label="Course">{[i.course, i.yearOfStudy].filter(Boolean).join(' · ') || '—'}</Row>
          <Row label="Department">{i.employee.department || '—'}</Row>
          {i.stipend != null && <Row label="Stipend">{i.stipend ? `${inr(i.stipend)} per month` : 'Unpaid'}</Row>}
          <Row label="Contact">{[i.employee.email, i.employee.phone].filter(Boolean).join(' · ') || '—'}</Row>
          <Row label="Login">{i.login ? `${i.login.email} (${i.login.status})` : 'No login yet — create one under Users & Roles with the Intern role'}</Row>
        </CardContent>
      </Card>
      <div className="space-y-4">
        {i.completion?.date && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Completion</CardTitle>
            </CardHeader>
            <CardContent>
              <Row label="Date">{dayjs(i.completion.date).format('DD MMM YYYY')}</Row>
              {i.completion.rating && <Row label="Rating">{'★'.repeat(i.completion.rating)}{'☆'.repeat(5 - i.completion.rating)}</Row>}
              <Row label="Certificate">{i.completion.certificateIssued ? 'Issued' : 'Not issued'}</Row>
              {i.completion.feedback && <Row label="Feedback">{i.completion.feedback}</Row>}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {[...i.history].reverse().map((h, k) => (
              <div key={k}>
                <span className="text-xs text-muted-foreground">{dayjs(h.at).format('DD MMM YYYY')}</span> · {h.from ? `${INTERN_STATUS_LABEL[h.from as keyof typeof INTERN_STATUS_LABEL] ?? h.from} → ` : ''}
                {INTERN_STATUS_LABEL[h.to as keyof typeof INTERN_STATUS_LABEL] ?? h.to}
                {h.byName && <span className="text-muted-foreground"> by {h.byName}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Onboarding({ i }: { i: InternDetail }) {
  const qc = useQueryClient();
  const [items, setItems] = useState(i.checklist.map((c) => ({ label: c.label, done: c.done, note: c.note ?? '' })));
  const [newItem, setNewItem] = useState('');
  useEffect(() => setItems(i.checklist.map((c) => ({ label: c.label, done: c.done, note: c.note ?? '' }))), [i.checklist]);
  const save = useSend<typeof items>('put', `/interns/${i._id}/checklist`, {
    body: (v) => ({ items: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['interns'] }),
  });
  const update = (next: typeof items) => {
    setItems(next);
    save.mutate(next);
  };
  const meta = new Map(i.checklist.map((c) => [c.label, c]));
  return (
    <Card>
      <CardContent className="space-y-2 pt-5">
        {items.map((c, k) => {
          const m = meta.get(c.label);
          return (
            <div key={c.label} className="flex items-center gap-3 rounded-md border p-2 text-sm">
              <Checkbox checked={c.done} disabled={!i.canGuide} aria-label={c.label} onChange={(e) => update(items.map((x, j) => (j === k ? { ...x, done: e.target.checked } : x)))} />
              <span className={c.done ? 'flex-1 text-muted-foreground line-through' : 'flex-1'}>{c.label}</span>
              {c.done && m?.doneAt && (
                <span className="text-xs text-muted-foreground">
                  {dayjs(m.doneAt).format('DD MMM')} · {m.doneByName}
                </span>
              )}
              {i.canManage && (
                <button aria-label={`Remove ${c.label}`} onClick={() => update(items.filter((_, j) => j !== k))}>
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
          );
        })}
        {i.canManage && (
          <div className="flex gap-2 pt-2">
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a step, e.g. Bank details for stipend" />
            <Button
              variant="outline"
              disabled={!newItem.trim() || items.some((x) => x.label === newItem.trim())}
              onClick={() => {
                update([...items, { label: newItem.trim(), done: false, note: '' }]);
                setNewItem('');
              }}
            >
              <Plus /> Add step
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">When every step is ticked, an onboarding intern becomes Active automatically.</p>
      </CardContent>
    </Card>
  );
}

function Documents({ i }: { i: InternDetail }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const del = useSend<string>('delete', (docId) => `/interns/${i._id}/documents/${docId}`, { invalidate: [['interns']], success: 'Removed' });
  const canUpload = i.canManage || i.isSelf;
  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      await api.post(`/interns/${i._id}/documents`, file, { params: { name: file.name, title }, headers: { 'Content-Type': file.type || 'application/octet-stream' }, transformRequest: [(d) => d] });
      toast.success('Document added');
      setTitle('');
      setFile(null);
      qc.invalidateQueries({ queryKey: ['interns'] });
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {canUpload && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 pt-5">
            <Field label="Document" className="w-64">
              <Select value={title} onChange={(e) => setTitle(e.target.value)}>
                <option value="">Choose…</option>
                {['Offer letter', 'Signed offer letter', 'College letter / NOC', 'ID proof', 'Resume', 'NDA', 'Bank details', 'Completion certificate', 'Other'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="File" className="flex-1">
              <input type="file" className="block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <Button disabled={busy || !file || !title} onClick={upload}>
              <Upload /> Upload
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Document</TH>
                <TH>File</TH>
                <TH>Added</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!i.documents.length && <EmptyRow cols={4} text="No documents yet." />}
              {i.documents.map((d) => (
                <TR key={d._id}>
                  <TD className="font-medium">{d.title}</TD>
                  <TD className="text-xs">
                    {d.name} · {fmtSize(d.size)}
                  </TD>
                  <TD className="text-xs">
                    {dayjs(d.createdAt).format('DD MMM YYYY')} · {d.uploadedByName}
                  </TD>
                  <TD className="text-right">
                    <Button size="icon" variant="ghost" aria-label={`Download ${d.title}`} onClick={() => downloadFile(`/interns/${i._id}/documents/${d._id}`, d.name)}>
                      <Download />
                    </Button>
                    {i.canManage && (
                      <Button size="icon" variant="ghost" className="text-destructive" aria-label={`Remove ${d.title}`} onClick={() => window.confirm(`Remove "${d.title}"?`) && del.mutate(d._id)}>
                        <Trash2 />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Allocations({ i, closed }: { i: InternDetail; closed: boolean }) {
  const projects = useGet<{ _id: string; code: string; name: string }[]>(['interns', 'projects'], '/interns/projects', undefined, i.canGuide);
  const [f, setF] = useState({ project: '', from: dayjs().format('YYYY-MM-DD'), to: '', note: '' });
  const add = useSend('post', `/interns/${i._id}/allocations`, { invalidate: [['interns'], ['projects']], success: 'Allocated', body: () => f, onSuccess: () => setF({ ...f, project: '', note: '' }) });
  const remove = useSend<string>('delete', (aid) => `/interns/${i._id}/allocations/${aid}`, { invalidate: [['interns'], ['projects']], success: 'Removed' });
  return (
    <div className="space-y-3">
      {i.canGuide && !closed && (
        <Card>
          <CardContent className="grid items-end gap-2 pt-5 sm:grid-cols-[1fr_9rem_9rem_1fr_auto]">
            <Field label="Project">
              <Select value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })}>
                <option value="">Choose…</option>
                {projects.data?.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            </Field>
            <Field label="To (optional)">
              <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
            </Field>
            <Field label="Role / note">
              <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Frontend, site drawings" />
            </Field>
            <Button disabled={!f.project || add.isPending} onClick={() => add.mutate(undefined)}>
              <Plus /> Allocate
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Period</TH>
                <TH>Role / note</TH>
                <TH>By</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!i.allocations.length && <EmptyRow cols={5} text="Not allocated to any project yet." />}
              {i.allocations.map((a) => (
                <TR key={a._id}>
                  <TD>
                    <Link to={`/projects/${a.project?._id}`} className="font-medium hover:underline">
                      {a.project?.code} · {a.project?.name}
                    </Link>
                  </TD>
                  <TD className="text-xs">
                    {dayjs(a.from).format('DD MMM YYYY')} – {a.to ? dayjs(a.to).format('DD MMM YYYY') : 'ongoing'}
                  </TD>
                  <TD className="text-sm">{a.note}</TD>
                  <TD className="text-xs">{a.byName}</TD>
                  <TD className="text-right">
                    {i.canGuide && (
                      <Button size="icon" variant="ghost" aria-label="Remove allocation" onClick={() => window.confirm('Remove this allocation? They also leave the project team.') && remove.mutate(a._id)}>
                        <Trash2 />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Allocating adds the intern to the project team, so they can see it and log time on its tasks.</p>
    </div>
  );
}

function Stipend({ i }: { i: InternDetail }) {
  const [f, setF] = useState({ month: dayjs().subtract(1, 'month').format('YYYY-MM'), amount: String((i.stipend ?? 0) / 100), paidOn: dayjs().format('YYYY-MM-DD'), note: '' });
  const add = useSend('post', `/interns/${i._id}/stipend`, { invalidate: [['interns']], success: 'Payment recorded', body: () => ({ ...f, amount: Number(f.amount) || 0 }) });
  const del = useSend<string>('delete', (pid) => `/interns/${i._id}/stipend/${pid}`, { invalidate: [['interns']], success: 'Removed' });
  const total = (i.stipendPayments ?? []).reduce((s, p) => s + p.amount, 0);
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="grid items-end gap-2 pt-5 sm:grid-cols-[9rem_9rem_9rem_1fr_auto]">
          <Field label="Month">
            <Input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />
          </Field>
          <Field label="Amount (₹)">
            <Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label="Paid on">
            <Input type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} />
          </Field>
          <Field label="Note">
            <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Bank transfer ref" />
          </Field>
          <Button disabled={add.isPending || !f.month} onClick={() => add.mutate(undefined)}>
            Record
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Month</TH>
                <TH>Amount</TH>
                <TH>Paid on</TH>
                <TH>Note</TH>
                <TH>By</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!i.stipendPayments?.length && <EmptyRow cols={6} text={i.stipend ? 'No payments recorded yet.' : 'This is an unpaid internship.'} />}
              {i.stipendPayments?.map((p) => (
                <TR key={p._id}>
                  <TD>{dayjs(`${p.month}-01`).format('MMM YYYY')}</TD>
                  <TD>{inr(p.amount)}</TD>
                  <TD className="text-xs">{dayjs(p.paidOn).format('DD MMM YYYY')}</TD>
                  <TD className="text-sm">{p.note}</TD>
                  <TD className="text-xs">{p.byName}</TD>
                  <TD className="text-right">
                    <Button size="icon" variant="ghost" aria-label="Remove payment" onClick={() => window.confirm('Remove this payment record?') && del.mutate(p._id)}>
                      <Trash2 />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Total paid: {inr(total)}. Stipends are recorded here and are not part of payroll runs.</p>
    </div>
  );
}

function EditIntern({ i, open, onClose }: { i: InternDetail; open: boolean; onClose: () => void }) {
  const mentors = useGet<PersonRef[]>(['interns', 'mentors'], '/interns/mentors', undefined, open);
  const init = () => ({
    name: i.employee.name,
    email: i.employee.email ?? '',
    phone: i.employee.phone ?? '',
    department: i.employee.department ?? '',
    designation: i.employee.designation ?? 'Intern',
    college: i.college,
    course: i.course ?? '',
    yearOfStudy: i.yearOfStudy ?? '',
    startDate: i.startDate,
    endDate: i.endDate,
    mentor: i.mentor?._id ?? '',
    stipend: String((i.stipend ?? 0) / 100),
  });
  const [f, setF] = useState(init);
  useEffect(() => {
    if (open) setF(init());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: keyof ReturnType<typeof init>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useSend('put', `/interns/${i._id}`, { invalidate: [['interns']], success: 'Saved', onSuccess: onClose, body: () => ({ ...f, mentor: f.mentor || null, stipend: Number(f.stipend) || 0 }) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit intern</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Email">
            <Input value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Department">
            <Input value={f.department} onChange={set('department')} />
          </Field>
          <Field label="College">
            <Input value={f.college} onChange={set('college')} />
          </Field>
          <Field label="Course">
            <Input value={f.course} onChange={set('course')} />
          </Field>
          <Field label="Year of study">
            <Input value={f.yearOfStudy} onChange={set('yearOfStudy')} />
          </Field>
          <Field label="Designation">
            <Input value={f.designation} onChange={set('designation')} />
          </Field>
          <Field label="Start date">
            <Input type="date" value={f.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="End date (extend here)">
            <Input type="date" value={f.endDate} onChange={set('endDate')} />
          </Field>
          <Field label="Mentor">
            <Select value={f.mentor} onChange={set('mentor')}>
              <option value="">None</option>
              {mentors.data?.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Monthly stipend (₹)">
            <Input type="number" min={0} value={f.stipend} onChange={set('stipend')} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ i, open, onClose }: { i: InternDetail; open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ status: i.status === 'converted' ? 'completed' : i.status, rating: '5', feedback: '', certificateIssued: true, date: dayjs().format('YYYY-MM-DD') });
  const ending = f.status === 'completed' || f.status === 'dropped';
  const save = useSend('patch', `/interns/${i._id}/status`, {
    invalidate: [['interns']],
    success: 'Status updated',
    onSuccess: onClose,
    body: () => ({ status: f.status, ...(ending ? { rating: f.status === 'completed' ? Number(f.rating) : undefined, feedback: f.feedback, certificateIssued: f.certificateIssued, date: f.date } : {}) }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change internship status</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
              {(['onboarding', 'active', 'completed', 'dropped'] as const).map((s) => (
                <option key={s} value={s}>
                  {INTERN_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          {ending && (
            <>
              <Field label={f.status === 'completed' ? 'Completion date' : 'Last day'}>
                <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
              </Field>
              {f.status === 'completed' && (
                <>
                  <Field label="Overall rating">
                    <Select value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })}>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {'★'.repeat(n)} ({n})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={f.certificateIssued} onChange={(e) => setF({ ...f, certificateIssued: e.target.checked })} /> Completion certificate issued
                  </label>
                </>
              )}
              <Field label="Feedback">
                <Textarea rows={3} value={f.feedback} onChange={(e) => setF({ ...f, feedback: e.target.value })} />
              </Field>
              <p className="text-xs text-muted-foreground">Ending the internship disables the intern's login and stops attendance from that date.</p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ i, open, onClose }: { i: InternDetail; open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ code: '', designation: '', dateOfJoining: dayjs().format('YYYY-MM-DD') });
  const save = useSend('post', `/interns/${i._id}/convert`, {
    invalidate: [['interns'], ['employees']],
    success: 'Converted to employee',
    onSuccess: onClose,
    body: () => ({ code: f.code || undefined, designation: f.designation || undefined, dateOfJoining: f.dateOfJoining }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hire {i.employee.name} as an employee</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="New employee code (optional)">
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder={`Keep ${i.employee.code}`} />
          </Field>
          <Field label="Designation">
            <Input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} placeholder="e.g. Junior Developer" />
          </Field>
          <Field label="Date of joining as employee">
            <Input type="date" value={f.dateOfJoining} onChange={(e) => setF({ ...f, dateOfJoining: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">They move to the Employees list with the Employee role and are included in payroll. Set up their salary under Employees → Salary.</p>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || !f.dateOfJoining} onClick={() => save.mutate(undefined)}>
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
