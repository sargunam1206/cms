import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { Plus, Search } from 'lucide-react';
import { useDebounced, useGet, useSend } from '@/api/hooks';
import { PageHeader } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { INTERN_STATUS_LABEL, inr, type InternRow, type InternStatus, type PersonRef } from './types';

export function InternStatusBadge({ status }: { status: InternStatus }) {
  const v = status === 'active' ? 'success' : status === 'onboarding' ? 'warning' : status === 'dropped' ? 'destructive' : status === 'converted' ? 'default' : 'secondary';
  return <Badge variant={v}>{INTERN_STATUS_LABEL[status]}</Badge>;
}

export function InternsPage() {
  const [view, setView] = useViewMode('interns');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const { data } = useGet<{ items: InternRow[]; canManage: boolean }>(['interns', 'list'], '/interns', { status: status || undefined, q: dq || undefined });
  const today = dayjs().format('YYYY-MM-DD');
  return (
    <>
      <PageHeader
        title="Interns"
        description={data?.canManage ? 'Onboarding, mentors, documents, stipend and internship progress.' : 'Interns you mentor.'}
        actions={
          data?.canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add intern
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-64 pl-8" placeholder="Search name, code, email, college" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(INTERN_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
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
                  <TH>Intern</TH>
                  <TH>College</TH>
                  <TH>Internship</TH>
                  <TH>Mentor</TH>
                  <TH>Onboarding</TH>
                  <TH>Work</TH>
                  {data?.canManage && <TH>Stipend</TH>}
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {!data?.items.length && <EmptyRow cols={8} text={data?.canManage ? 'No interns yet. Use "Add intern" to start onboarding.' : 'No interns assigned to you.'} />}
                {data?.items.map((i) => {
                  const ending = i.status === 'active' && i.endDate >= today && i.endDate <= dayjs().add(14, 'day').format('YYYY-MM-DD');
                  return (
                    <TR key={i._id}>
                      <TD>
                        <Link to={`/interns/${i._id}`} className="font-medium hover:underline">
                          {i.employee.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {i.employee.code}
                          {i.employee.email ? ` · ${i.employee.email}` : ''}
                        </div>
                      </TD>
                      <TD className="text-sm">
                        {i.college}
                        {i.course && <div className="text-xs text-muted-foreground">{i.course}</div>}
                      </TD>
                      <TD className="whitespace-nowrap text-xs">
                        {dayjs(i.startDate).format('DD MMM YYYY')} – {dayjs(i.endDate).format('DD MMM YYYY')}
                        {ending && <div className="font-medium text-amber-700">ends soon</div>}
                      </TD>
                      <TD className="text-sm">{i.mentor?.name ?? <span className="text-muted-foreground">—</span>}</TD>
                      <TD className="text-xs">
                        {i.onboarding.done}/{i.onboarding.total}
                      </TD>
                      <TD className="text-xs">
                        {i.work.approved}/{i.work.total} approved
                        {!!i.work.submitted && <div className="text-amber-700">{i.work.submitted} to review</div>}
                      </TD>
                      {data.canManage && <TD className="text-sm">{i.stipend ? `${inr(i.stipend)}/mo` : 'Unpaid'}</TD>}
                      <TD>
                        <InternStatusBadge status={i.status} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        ) : (
        <CardGrid
          items={data?.items}
          empty="No interns."
          render={(i) => (
            <Card key={i._id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/interns/${i._id}`} className="block truncate font-medium hover:underline">{i.employee.name}</Link>
                    <div className="truncate text-xs text-muted-foreground">{i.employee.code}{i.employee.email ? ` · ${i.employee.email}` : ''}</div>
                  </div>
                  <InternStatusBadge status={i.status} />
                </div>
                <CardLine label="College">{i.college}</CardLine>
                {i.course && <CardLine label="Course">{i.course}</CardLine>}
                <CardLine label="Period">{dayjs(i.startDate).format('DD MMM YY')} – {dayjs(i.endDate).format('DD MMM YY')}</CardLine>
                <CardLine label="Mentor">{i.mentor?.name ?? '—'}</CardLine>
                <CardLine label="Onboarding">{i.onboarding.done}/{i.onboarding.total}</CardLine>
                <CardLine label="Work">{i.work.approved}/{i.work.total} approved{i.work.submitted ? ` · ${i.work.submitted} to review` : ''}</CardLine>
                {data?.canManage && <CardLine label="Stipend">{i.stipend ? `${inr(i.stipend)}/mo` : 'Unpaid'}</CardLine>}
              </CardContent>
            </Card>
          )}
        />
        )}
      </>
      <AddIntern open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

const BLANK = { code: '', name: '', email: '', phone: '', department: '', designation: 'Intern', college: '', course: '', yearOfStudy: '', startDate: '', endDate: '', mentor: '', stipend: '0', password: '' };

function AddIntern({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const mentors = useGet<PersonRef[]>(['interns', 'mentors'], '/interns/mentors', undefined, open);
  const [f, setF] = useState(BLANK);
  const [last, setLast] = useState(false);
  if (open !== last) {
    setLast(open);
    if (open) setF({ ...BLANK, startDate: dayjs().format('YYYY-MM-DD'), endDate: dayjs().add(3, 'month').format('YYYY-MM-DD') });
  }
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useSend<void, { _id: string }>('post', '/interns', {
    invalidate: [['interns']],
    success: 'Intern added',
    onSuccess: (r) => {
      onClose();
      nav(`/interns/${r._id}`);
    },
    body: () => ({ ...f, mentor: f.mentor || null, stipend: Number(f.stipend) || 0 }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add an intern</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Intern code">
            <Input value={f.code} onChange={set('code')} placeholder="e.g. INT-2026-01" />
          </Field>
          <Field label="Full name">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="College">
            <Input value={f.college} onChange={set('college')} />
          </Field>
          <Field label="Course">
            <Input value={f.course} onChange={set('course')} placeholder="e.g. B.E. Computer Science" />
          </Field>
          <Field label="Year of study">
            <Input value={f.yearOfStudy} onChange={set('yearOfStudy')} placeholder="e.g. Final year" />
          </Field>
          <Field label="Department">
            <Input value={f.department} onChange={set('department')} />
          </Field>
          <Field label="Start date">
            <Input type="date" value={f.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="End date">
            <Input type="date" value={f.endDate} onChange={set('endDate')} />
          </Field>
          <Field label="Mentor">
            <Select value={f.mentor} onChange={set('mentor')}>
              <option value="">Choose later</option>
              {mentors.data?.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name}
                  {m.designation ? ` · ${m.designation}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Monthly stipend (₹, 0 if unpaid)">
            <Input type="number" min={0} value={f.stipend} onChange={set('stipend')} />
          </Field>
          <Field label="Login password (optional)" className="sm:col-span-2">
            <Input type="password" value={f.password} onChange={set('password')} placeholder="Set one to create the intern's login now (needs the email)" autoComplete="new-password" />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">The intern gets an Intern login: attendance, leave, timesheet, meetings, ideas and their work board. No payslips; stipend is tracked here.</p>
        <DialogFooter>
          <Button disabled={save.isPending || !f.code || f.name.trim().length < 2 || f.college.trim().length < 2 || !f.startDate || !f.endDate} onClick={() => save.mutate(undefined)}>
            Add intern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
