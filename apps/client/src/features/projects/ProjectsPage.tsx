import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useDebounced, useGet, useSend } from '@/api/hooks';
import type { Paged } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Pager } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { BILLING, PROJECT_STATUSES, projectStatusLabel, type ClientRow, type Person, type ProjectDetail, type ProjectRow } from './types';
import { PersonOptions } from '@/components/common/PersonOptions';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'secondary' | 'default' | 'destructive'> = {
  active: 'success',
  planning: 'default',
  on_hold: 'warning',
  completed: 'secondary',
  cancelled: 'destructive',
};
export const ProjectStatusBadge = ({ status }: { status: string }) => <Badge variant={STATUS_VARIANT[status] ?? 'secondary'}>{projectStatusLabel(status)}</Badge>;

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={`${done} of ${total} tasks done`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {done}/{total}
      </span>
    </div>
  );
}

export function ProjectsPage() {
  const [view, setView] = useViewMode('projects');
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q);
  const { data } = useGet<Paged<ProjectRow>>(['projects', 'list'], '/projects', { q: dq || undefined, status: status || undefined, mine: mine ? 'true' : undefined, page, limit: 50 });
  const today = dayjs().format('YYYY-MM-DD');

  return (
    <>
      <PageHeader
        title="Projects"
        description={can(P.PROJECTS_VIEW) ? 'All projects' : 'Projects you lead or belong to'}
        actions={can(P.PROJECTS_MANAGE) && <Button onClick={() => setCreating(true)}><Plus /> New project</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name or code" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        {can(P.PROJECTS_VIEW) && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} /> Only mine
          </label>
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
                  <TH>Project</TH>
                  <TH>Client</TH>
                  <TH>Manager</TH>
                  <TH>Status</TH>
                  <TH>Progress</TH>
                  <TH>Overdue</TH>
                  <TH>Due</TH>
                </TR>
              </THead>
              <TBody>
                {!data?.items.length && <EmptyRow cols={7} text="No projects yet" />}
                {data?.items.map((p) => (
                  <TR key={p._id}>
                    <TD>
                      <Link to={`/projects/${p._id}`} className="font-medium text-primary hover:underline">
                        {p.name}
                      </Link>
                      <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
                    </TD>
                    <TD>{p.client?.name ?? '—'}</TD>
                    <TD>{p.manager?.name}</TD>
                    <TD>
                      <ProjectStatusBadge status={p.status} />
                    </TD>
                    <TD>
                      <Progress done={p.stats.done} total={p.stats.total} />
                    </TD>
                    <TD>{p.stats.overdue ? <Badge variant="destructive">{p.stats.overdue}</Badge> : <span className="text-muted-foreground">0</span>}</TD>
                    <TD className={p.dueDate && p.dueDate < today && !['completed', 'cancelled'].includes(p.status) ? 'text-red-700' : ''}>{fmtDate(p.dueDate)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        ) : (
        <CardGrid
          items={data?.items}
          empty="No projects yet."
          render={(p) => (
            <Card key={p._id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/projects/${p._id}`} className="block truncate font-medium text-primary hover:underline">{p.name}</Link>
                    <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
                  </div>
                  <ProjectStatusBadge status={p.status} />
                </div>
                <Progress done={p.stats.done} total={p.stats.total} />
                <CardLine label="Client">{p.client?.name ?? '—'}</CardLine>
                <CardLine label="Manager">{p.manager?.name}</CardLine>
                <CardLine label="Overdue tasks">{p.stats.overdue ? <span className="font-medium text-red-700">{p.stats.overdue}</span> : '0'}</CardLine>
                <CardLine label="Due"><span className={p.dueDate && p.dueDate < today && !['completed', 'cancelled'].includes(p.status) ? 'text-red-700' : ''}>{fmtDate(p.dueDate)}</span></CardLine>
              </CardContent>
            </Card>
          )}
        />
        )}
      </>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      <ProjectDialog open={creating} project={null} onClose={() => setCreating(false)} onSaved={(id) => nav(`/projects/${id}`)} />
    </>
  );
}

const BLANK = { code: '', name: '', client: '', manager: '', members: [] as string[], status: 'planning', billingType: 'time_material', startDate: '', dueDate: '', budgetHours: '', description: '' };

/** Create or edit a project. A Manager can only lead their own projects; Admin and Management pick the lead. */
export function ProjectDialog({ open, project, onClose, onSaved }: { open: boolean; project: ProjectDetail | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { can, user } = useAuth();
  const wide = can(P.PROJECTS_VIEW); // may assign anyone as lead
  const clients = useGet<ClientRow[]>(['projects', 'clients'], '/projects/clients', { active: 'true' }, open);
  const people = useGet<Person[]>(['projects', 'people'], '/projects/people', undefined, open);
  const [f, setF] = useState(BLANK);
  const [find, setFind] = useState('');
  useEffect(() => {
    if (!open) return;
    setFind('');
    if (project) {
      setF({
        code: project.code,
        name: project.name,
        client: project.client?._id ?? '',
        manager: project.manager._id,
        members: project.members.map((m) => m._id),
        status: project.status,
        billingType: project.billingType,
        startDate: project.startDate ?? '',
        dueDate: project.dueDate ?? '',
        budgetHours: project.budgetHours != null ? String(project.budgetHours) : '',
        description: project.description ?? '',
      });
    } else setF({ ...BLANK, manager: user?.employee?._id ?? '' });
  }, [open, project, user]);

  const save = useSend<{ _id: string }, { _id: string }>(project ? 'put' : 'post', project ? `/projects/${project._id}` : '/projects', {
    invalidate: [['projects']],
    success: 'Project saved',
    body: () => ({ ...f, client: f.client || null, budgetHours: f.budgetHours ? Number(f.budgetHours) : undefined }),
    onSuccess: (r) => {
      onClose();
      onSaved?.(r._id);
    },
  });
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const shown = (people.data ?? []).filter((p) => !find || `${p.name} ${p.code}`.toLowerCase().includes(find.toLowerCase()));
  const toggle = (id: string) => setF({ ...f, members: f.members.includes(id) ? f.members.filter((m) => m !== id) : [...f.members, id] });
  const canSave = f.code.trim().length >= 2 && f.name.trim().length >= 2 && !!f.manager;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{project ? `Edit ${project.code}` : 'New project'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project code (e.g. PRJ-001)">
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Project name">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Client">
            <Select value={f.client} onChange={set('client')}>
              <option value="">No client (internal)</option>
              {clients.data?.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project manager">
            <Select value={f.manager} onChange={set('manager')} disabled={!wide}>
              <option value="">Select…</option>
              <PersonOptions people={people.data ?? []} />
            </Select>
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={set('status')}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Billing">
            <Select value={f.billingType} onChange={set('billingType')}>
              {BILLING.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date">
            <Input type="date" value={f.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={f.dueDate} onChange={set('dueDate')} />
          </Field>
          <Field label="Budget (hours, optional)">
            <Input type="number" min={0} value={f.budgetHours} onChange={set('budgetHours')} />
          </Field>
          <span />
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={2} value={f.description} onChange={set('description')} />
          </Field>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Team members ({f.members.length} selected)</h4>
            <Input className="w-48" placeholder="Find a person" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find a person" />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border p-2">
            {[
              { title: 'Employees', list: shown.filter((p) => p.type !== 'intern') },
              { title: 'Interns', list: shown.filter((p) => p.type === 'intern') },
            ]
              .filter((g) => g.list.length)
              .map((g, _k, groups) => (
                <div key={g.title}>
                  {groups.length > 1 && <div className="px-1 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</div>}
                  {g.list.map((p) => (
                    <label key={p._id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                      <Checkbox checked={f.members.includes(p._id) || p._id === f.manager} disabled={p._id === f.manager} onChange={() => toggle(p._id)} />
                      {p.name} <span className="text-xs text-muted-foreground">{p.code}{p.department ? ` · ${p.department}` : ''}{p._id === f.manager ? ' · manager' : ''}</span>
                    </label>
                  ))}
                </div>
              ))}
            {!shown.length && <p className="p-2 text-sm text-muted-foreground">No one found</p>}
          </div>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || !canSave} onClick={() => save.mutate({ _id: '' })}>
            Save project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
