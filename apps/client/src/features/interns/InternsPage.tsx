import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { INTERN_SOURCE_LABEL } from '@cms/shared';
import { useDebounced, useGet } from '@/api/hooks';
import { PageHeader } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { InternFormDialog, useDeleteIntern } from './InternForm';
import { INTERN_STATUS_LABEL, payText, type InternRow, type InternStatus } from './types';

export function InternStatusBadge({ status }: { status: InternStatus }) {
  const v = status === 'active' ? 'success' : status === 'onboarding' ? 'warning' : status === 'dropped' ? 'destructive' : status === 'converted' ? 'default' : 'secondary';
  return <Badge variant={v}>{INTERN_STATUS_LABEL[status]}</Badge>;
}

export function InternsPage() {
  const [view, setView] = useViewMode('interns');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const del = useDeleteIntern();
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
          <Input className="w-64 pl-8" placeholder="Search name, code, email, college, company" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  <TH>From</TH>
                  <TH>Internship</TH>
                  <TH>Mentor</TH>
                  <TH>Onboarding</TH>
                  <TH>Work</TH>
                  {data?.canManage && <TH>Stipend</TH>}
                  <TH>Status</TH>
                  {data?.canManage && <TH />}
                </TR>
              </THead>
              <TBody>
                {!data?.items.length && <EmptyRow cols={data?.canManage ? 9 : 7} text={data?.canManage ? 'No interns yet. Use "Add intern" to start onboarding.' : 'No interns assigned to you.'} />}
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
                        {i.organization}
                        <div className="text-xs text-muted-foreground">{[INTERN_SOURCE_LABEL[i.source], i.course].filter(Boolean).join(' · ')}</div>
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
                      {data.canManage && (
                        <TD className="text-sm">
                          {payText(i)}
                          {i.payBasis === 'hourly' && <div className="text-xs text-muted-foreground">hourly{i.hoursPerWeek ? ` · ${i.hoursPerWeek} h/week` : ''}</div>}
                        </TD>
                      )}
                      <TD>
                        <InternStatusBadge status={i.status} />
                      </TD>
                      {data.canManage && (
                        <TD className="whitespace-nowrap text-right">
                          <Button size="icon" variant="ghost" aria-label={`Edit ${i.employee.name}`} onClick={() => setEditId(i._id)}>
                            <Pencil />
                          </Button>
                          {i.status !== 'converted' && (
                            <Button size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${i.employee.name}`} disabled={del.isPending} onClick={() => del.ask(i._id, i.employee.name)}>
                              <Trash2 />
                            </Button>
                          )}
                        </TD>
                      )}
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
                <CardLine label={INTERN_SOURCE_LABEL[i.source]}>{i.organization}</CardLine>
                {i.course && <CardLine label="Course">{i.course}</CardLine>}
                <CardLine label="Period">{dayjs(i.startDate).format('DD MMM YY')} – {dayjs(i.endDate).format('DD MMM YY')}</CardLine>
                <CardLine label="Mentor">{i.mentor?.name ?? '—'}</CardLine>
                <CardLine label="Onboarding">{i.onboarding.done}/{i.onboarding.total}</CardLine>
                <CardLine label="Work">{i.work.approved}/{i.work.total} approved{i.work.submitted ? ` · ${i.work.submitted} to review` : ''}</CardLine>
                {data?.canManage && <CardLine label="Stipend">{payText(i)}</CardLine>}
                {data?.canManage && (
                  <div className="flex justify-end gap-1 border-t pt-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditId(i._id)}>
                      <Pencil /> Edit
                    </Button>
                    {i.status !== 'converted' && (
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={del.isPending} onClick={() => del.ask(i._id, i.employee.name)}>
                        <Trash2 /> Delete
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        />
        )}
      </>
      <InternFormDialog open={adding} onClose={() => setAdding(false)} />
      <InternFormDialog open={!!editId} editId={editId ?? undefined} onClose={() => setEditId(null)} />
    </>
  );
}
