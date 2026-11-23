import { useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { Download, Search } from 'lucide-react';
import { PROJECT_DOC_CATEGORIES, PROJECT_DOC_CATEGORY_LABEL } from '@cms/shared';
import { useDebounced, useGet } from '@/api/hooks';
import { cn } from '@/lib/utils';
import { downloadFile } from '@/lib/download';
import { PageHeader, Pager, Stat } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { ProjectStatusBadge } from './ProjectsPage';
import { fmtSize } from './TaskFiles';

interface Row {
  _id: string;
  code: string;
  name: string;
  status: string;
  manager?: string;
  client?: string | null;
  dueDate?: string;
  team: number;
  tasks: { total: number; done: number; inProgress: number; blocked: number; overdue: number };
  progress: number;
  milestones: { total: number; done: number; late: number };
  documents: { count: number; versions: number; lastAt: string | null };
  hoursLogged: number;
  budgetHours: number | null;
  lastActivity: string | null;
  health: 'green' | 'amber' | 'red';
}
interface DocRow {
  _id: string;
  project: { _id: string; code: string; name: string };
  title: string;
  category: string;
  version: number;
  createdByName?: string;
  latest: { _id: string; name: string; size: number; uploadedByName?: string; at: string; note?: string } | null;
  downloads: number;
  lastDownload: { at: string; by: string } | null;
}
interface Activity {
  _id: string;
  at: string;
  by: string;
  action: string;
  project: string | null;
  subject: string;
  detail: string;
  number: number | null;
}

const HEALTH = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' } as const;
const HEALTH_LABEL = { green: 'On track', amber: 'Needs attention', red: 'Late' } as const;
const catLabel = (c: string) => PROJECT_DOC_CATEGORY_LABEL[c as keyof typeof PROJECT_DOC_CATEGORY_LABEL] ?? c;
const ACTION_LABEL: Record<string, string> = {
  'project.document.add': 'added document',
  'project.document.version': 'uploaded a new version of',
  'project.document.download': 'downloaded',
  'project.document.remove': 'deleted document',
  'task.create': 'created task',
  'task.update': 'edited task',
  'task.status': 'moved task',
  'task.delete': 'deleted task',
  'task.file.add': 'attached a file to task',
  'task.file.remove': 'removed a file from task',
};
const ago = (d?: string | null) => (d ? dayjs(d).format('DD MMM, HH:mm') : '—');

/** Top-management view of every project: progress, documents and what happened. */
export function TrackerPage() {
  return (
    <>
      <PageHeader title="Project tracker" description="Progress, documents and activity across every project." />
      <Tabs defaultValue="progress">
        <TabsList>
          <TabsTrigger value="progress">Progress</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="progress">
          <Progress />
        </TabsContent>
        <TabsContent value="documents">
          <Documents />
        </TabsContent>
        <TabsContent value="activity">
          <Feed />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Progress() {
  const [view, setView] = useViewMode('tracker');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data } = useGet<{ items: Row[]; totals: { projects: number; atRisk: number; overdueTasks: number; documents: number } }>(['projects', 'tracker', 'summary'], '/projects/tracker/summary', { status: status || undefined, q: dq || undefined });
  return (
    <>
      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Projects" value={data.totals.projects} />
          <Stat label="Need attention" value={data.totals.atRisk} tone={data.totals.atRisk ? 'warn' : undefined} />
          <Stat label="Overdue tasks" value={data.totals.overdueTasks} tone={data.totals.overdueTasks ? 'bad' : undefined} />
          <Stat label="Documents" value={data.totals.documents} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-60 pl-8" placeholder="Search code or name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All open & closed</option>
          <option value="planning">Planning</option>
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
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
                  <TH>Project</TH>
                  <TH>Health</TH>
                  <TH>Progress</TH>
                  <TH>Tasks</TH>
                  <TH>Milestones</TH>
                  <TH>Hours</TH>
                  <TH>Documents</TH>
                  <TH>Due</TH>
                  <TH>Last activity</TH>
                </TR>
              </THead>
              <TBody>
                {!data?.items.length && <EmptyRow cols={9} text="No projects." />}
                {data?.items.map((p) => (
                  <TR key={p._id}>
                    <TD>
                      <Link to={`/projects/${p._id}`} className="font-medium hover:underline">
                        {p.code} · {p.name}
                      </Link>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ProjectStatusBadge status={p.status} /> {p.manager} · {p.team} people{p.client ? ` · ${p.client}` : ''}
                      </div>
                    </TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5 text-xs" title={HEALTH_LABEL[p.health]}>
                        <span className={cn('h-2.5 w-2.5 rounded-full', HEALTH[p.health])} /> {HEALTH_LABEL[p.health]}
                      </span>
                    </TD>
                    <TD className="w-36">
                      <div className="h-2 rounded bg-muted">
                        <div className="h-2 rounded bg-primary" style={{ width: `${p.progress}%` }} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.progress}% · {p.tasks.done}/{p.tasks.total} done
                      </div>
                    </TD>
                    <TD className="text-xs">
                      {p.tasks.inProgress} in progress
                      {!!p.tasks.overdue && <div className="font-medium text-red-600">{p.tasks.overdue} overdue</div>}
                      {!!p.tasks.blocked && <div className="text-amber-700">{p.tasks.blocked} blocked</div>}
                    </TD>
                    <TD className="text-xs">
                      {p.milestones.total ? `${p.milestones.done}/${p.milestones.total} done` : '—'}
                      {!!p.milestones.late && <div className="font-medium text-red-600">{p.milestones.late} late</div>}
                    </TD>
                    <TD className="whitespace-nowrap text-xs">
                      {p.hoursLogged} h{p.budgetHours ? ` / ${p.budgetHours} h` : ''}
                    </TD>
                    <TD className="text-xs">
                      {p.documents.count} ({p.documents.versions} versions)
                      {p.documents.lastAt && <div className="text-muted-foreground">updated {dayjs(p.documents.lastAt).format('DD MMM')}</div>}
                    </TD>
                    <TD className="whitespace-nowrap text-xs">{p.dueDate ? dayjs(p.dueDate).format('DD MMM YYYY') : '—'}</TD>
                    <TD className="whitespace-nowrap text-xs">{ago(p.lastActivity)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        ) : (
        <CardGrid
          items={data?.items}
          empty="No projects."
          render={(p) => (
            <Card key={p._id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/projects/${p._id}`} className="block truncate font-medium hover:underline">{p.code} · {p.name}</Link>
                    <div className="text-xs text-muted-foreground">{p.manager} · {p.team} people</div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs"><span className={cn('h-2.5 w-2.5 rounded-full', HEALTH[p.health])} /> {HEALTH_LABEL[p.health]}</span>
                </div>
                <div>
                  <div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${p.progress}%` }} /></div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{p.progress}% · {p.tasks.done}/{p.tasks.total} tasks done</div>
                </div>
                <CardLine label="Overdue / blocked">{p.tasks.overdue} / {p.tasks.blocked}</CardLine>
                <CardLine label="Milestones">{p.milestones.total ? `${p.milestones.done}/${p.milestones.total}${p.milestones.late ? ` · ${p.milestones.late} late` : ''}` : '—'}</CardLine>
                <CardLine label="Hours">{p.hoursLogged} h{p.budgetHours ? ` / ${p.budgetHours} h` : ''}</CardLine>
                <CardLine label="Documents">{p.documents.count} ({p.documents.versions} versions)</CardLine>
                <CardLine label="Due">{p.dueDate ? dayjs(p.dueDate).format('DD MMM YYYY') : '—'}</CardLine>
              </CardContent>
            </Card>
          )}
        />
        )}
      </>
      <p className="mt-2 text-xs text-muted-foreground">Late: past the project due date or a milestone. Needs attention: overdue or blocked tasks.</p>
    </>
  );
}

function Documents() {
  const projects = useGet<{ items: Row[] }>(['projects', 'tracker', 'summary', 'all'], '/projects/tracker/summary');
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data } = useGet<{ items: DocRow[]; total: number }>(['projects', 'tracker', 'docs'], '/projects/tracker/documents', { project: project || undefined, category: category || undefined, q: dq || undefined, page, limit: 50 });
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-56 pl-8" placeholder="Search title" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        </div>
        <Select className="w-56" value={project} onChange={(e) => (setProject(e.target.value), setPage(1))}>
          <option value="">All projects</option>
          {projects.data?.items.map((p) => (
            <option key={p._id} value={p._id}>
              {p.code} · {p.name}
            </option>
          ))}
        </Select>
        <Select className="w-48" value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))}>
          <option value="">All categories</option>
          {PROJECT_DOC_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {catLabel(c)}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Document</TH>
                <TH>Project</TH>
                <TH>Category</TH>
                <TH>Version</TH>
                <TH>Last change</TH>
                <TH>Downloads</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!data?.items.length && <EmptyRow cols={7} text="No project documents yet." />}
              {data?.items.map((d) => (
                <TR key={d._id}>
                  <TD>
                    <div className="font-medium">{d.title}</div>
                    {d.latest && (
                      <div className="text-xs text-muted-foreground">
                        {d.latest.name} · {fmtSize(d.latest.size)}
                      </div>
                    )}
                  </TD>
                  <TD className="text-sm">
                    <Link to={`/projects/${d.project._id}`} className="hover:underline">
                      {d.project.code}
                    </Link>
                  </TD>
                  <TD className="text-sm">{catLabel(d.category)}</TD>
                  <TD>v{d.version}</TD>
                  <TD className="text-xs">
                    {d.latest && (
                      <>
                        {ago(d.latest.at)} · {d.latest.uploadedByName}
                        {d.latest.note && <div className="text-muted-foreground">{d.latest.note}</div>}
                      </>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {d.downloads}
                    {d.lastDownload && (
                      <div className="text-muted-foreground">
                        last {ago(d.lastDownload.at)} by {d.lastDownload.by}
                      </div>
                    )}
                  </TD>
                  <TD className="text-right">
                    {d.latest && (
                      <Button size="icon" variant="ghost" aria-label={`Download ${d.title}`} onClick={() => downloadFile(`/projects/${d.project._id}/documents/${d._id}/versions/${d.latest!._id}`, d.latest!.name)}>
                        <Download />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      {data && <Pager page={page} limit={50} total={data.total} onPage={setPage} />}
    </>
  );
}

function Feed() {
  const projects = useGet<{ items: Row[] }>(['projects', 'tracker', 'summary', 'all'], '/projects/tracker/summary');
  const [project, setProject] = useState('');
  const [kind, setKind] = useState('');
  const { data } = useGet<Activity[]>(['projects', 'tracker', 'activity'], '/projects/tracker/activity', { project: project || undefined, kind: kind || undefined, limit: 150 });
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="w-56" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">All projects</option>
          {projects.data?.items.map((p) => (
            <option key={p._id} value={p.code}>
              {p.code} · {p.name}
            </option>
          ))}
        </Select>
        <Select className="w-44" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Tasks and documents</option>
          <option value="tasks">Tasks only</option>
          <option value="documents">Documents only</option>
        </Select>
      </div>
      <Card>
        <CardContent className="divide-y p-0 text-sm">
          {!data?.length && <p className="p-4 text-muted-foreground">Nothing yet.</p>}
          {data?.map((a) => (
            <div key={a._id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2">
              <span className="w-28 shrink-0 text-xs text-muted-foreground">{ago(a.at)}</span>
              <span className="font-medium">{a.by}</span>
              <span className="text-muted-foreground">{ACTION_LABEL[a.action] ?? a.action}</span>
              <span>
                {a.action.startsWith('task.') && a.project && a.number != null ? `${a.project}-${a.number} ` : ''}
                {a.subject}
              </span>
              {a.detail && <span className="text-xs text-muted-foreground">({a.detail})</span>}
              {a.project && !a.action.startsWith('task.') && <span className="text-xs text-muted-foreground">· {a.project}</span>}
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
