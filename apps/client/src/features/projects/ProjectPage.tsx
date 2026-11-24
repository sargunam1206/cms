import { useState } from 'react';
import dayjs from 'dayjs';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Search } from 'lucide-react';
import { useDebounced, useGet } from '@/api/hooks';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Spinner, Stat } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EstimateTab } from '@/features/estimates/EstimateTab';
import { TimelineTab } from '@/features/estimates/TimelineTab';
import { ProjectMeetings } from '@/features/meetings/ProjectMeetings';
import { ProjectDocuments } from './ProjectDocuments';
import { ProjectOverview } from './ProjectOverview';
import { Progress, ProjectDialog, ProjectStatusBadge } from './ProjectsPage';
import { TaskBoard } from './TaskBoard';
import { PriorityBadge, TaskDetailDialog, TaskFormDialog } from './TaskDialogs';
import { BILLING, PRIORITIES, TASK_STATUSES, isOverdue, statusLabel, type ProjectDetail, type TaskRow, type TaskStatus } from './types';

export function ProjectPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'board';
  const project = useGet<ProjectDetail>(['projects', 'detail', id], `/projects/${id}`);
  const [filters, setFilters] = useState({ q: '', status: '', assignee: '', priority: '', due: '' });
  const dq = useDebounced(filters.q);
  const tasks = useGet<TaskRow[]>(['projects', 'tasks', id], `/projects/${id}/tasks`, {
    q: dq || undefined,
    status: filters.status || undefined,
    assignee: filters.assignee || undefined,
    priority: filters.priority || undefined,
    due: filters.due || undefined,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ task: TaskRow | null; status?: string } | null>(null);
  const [editProject, setEditProject] = useState(false);
  const today = dayjs().format('YYYY-MM-DD');

  if (project.isError)
    return (
      <div className="py-20 text-center text-muted-foreground">
        This project does not exist, or you are not part of it.{' '}
        <Link to="/projects" className="text-primary underline">
          Back to projects
        </Link>
      </div>
    );
  if (project.isLoading || !project.data) return <Spinner />;
  const p = project.data;
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const team = [p.manager, ...p.members.filter((m) => m._id !== p.manager._id)];
  const donePct = p.stats.total ? Math.round((p.stats.done / p.stats.total) * 100) : 0;

  return (
    <>
      <PageHeader
        title={`${p.name}`}
        description={`${p.code} · ${p.client?.name ?? 'Internal'} · ${BILLING.find((b) => b.value === p.billingType)?.label}`}
        actions={
          <>
            <ProjectStatusBadge status={p.status} />
            {p.canManage && (
              <Button variant="outline" onClick={() => setEditProject(true)}>
                <Pencil /> Edit project
              </Button>
            )}
            {p.canAddTasks && (
              <Button onClick={() => setForm({ task: null })}>
                <Plus /> New task
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tasks" value={p.stats.total} />
        <Stat label="Done" value={`${donePct}%`} tone={donePct === 100 ? 'good' : undefined} />
        <Stat label="Overdue" value={p.stats.overdue} tone={p.stats.overdue ? 'bad' : undefined} />
        <Stat label="Estimated hours" value={p.budgetHours ? `${p.stats.estimateHours} of ${p.budgetHours}` : p.stats.estimateHours} />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Manager {p.manager.name}
        {p.startDate && ` · starts ${fmtDate(p.startDate)}`}
        {p.dueDate && ` · due ${fmtDate(p.dueDate)}`}
      </p>
      {p.description && <p className="mb-4 max-w-3xl whitespace-pre-wrap text-sm">{p.description}</p>}

      <Tabs value={tab} onValueChange={(t) => setParams(t === 'board' ? {} : { tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="estimate">Estimate</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="team">Team ({team.length})</TabsTrigger>
        </TabsList>

        {!(tab === 'estimate' || tab === 'timeline') && (
        <div className="my-3 flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search tasks" value={filters.q} onChange={set('q')} aria-label="Search tasks" />
          </div>
          <Select className="w-40" value={filters.assignee} onChange={set('assignee')} aria-label="Assignee">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {team.map((m) => (
              <option key={m._id} value={m._id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select className="w-36" value={filters.priority} onChange={set('priority')} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </Select>
          <Select className="w-36" value={filters.due} onChange={set('due')} aria-label="Due">
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="week">Due this week</option>
          </Select>
          <Select className="w-36" value={filters.status} onChange={set('status')} aria-label="Status filter">
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        )}

        <TabsContent value="overview">
          <ProjectOverview projectId={p._id} />
        </TabsContent>

        <TabsContent value="board">
          {tasks.data ? <TaskBoard tasks={tasks.data} canManage={p.canManage} canAdd={!!p.canAddTasks} onOpen={(t) => setOpen(t._id)} onAdd={(s: TaskStatus) => setForm({ task: null, status: s })} /> : <Spinner />}
        </TabsContent>

        <TabsContent value="list">
          <Card>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Task</TH>
                    <TH>Status</TH>
                    <TH>Priority</TH>
                    <TH>Assignee</TH>
                    <TH>Due</TH>
                    <TH>Estimate</TH>
                  </TR>
                </THead>
                <TBody>
                  {!tasks.data?.length && <EmptyRow cols={6} text="No tasks match" />}
                  {tasks.data?.map((t) => (
                    <TR key={t._id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(t._id)}>
                      <TD>
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{t.ref}</span>
                        <span className="font-medium">{t.title}</span>
                      </TD>
                      <TD>
                        <Badge variant="outline">{statusLabel(t.status)}</Badge>
                      </TD>
                      <TD>
                        <PriorityBadge priority={t.priority} />
                      </TD>
                      <TD>{t.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TD>
                      <TD className={isOverdue(t, today) ? 'font-medium text-red-700' : ''}>{fmtDate(t.dueDate)}</TD>
                      <TD>{t.estimateHours != null ? `${t.estimateHours} h` : '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <TimelineTab projectId={p._id} members={team} />
        </TabsContent>

        <TabsContent value="estimate">
          <EstimateTab projectId={p._id} />
        </TabsContent>

        <TabsContent value="documents">
          <ProjectDocuments projectId={p._id} />
        </TabsContent>

        <TabsContent value="meetings">
          <ProjectMeetings projectId={p._id} />
        </TabsContent>

        <TabsContent value="team">
          <Card>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Person</TH>
                    <TH>Role</TH>
                    <TH>Open tasks</TH>
                  </TR>
                </THead>
                <TBody>
                  {team.map((m) => (
                    <TR key={m._id}>
                      <TD className="font-medium">
                        {m.name} <span className="text-xs text-muted-foreground">{m.code}</span>
                      </TD>
                      <TD>{m._id === p.manager._id ? 'Project manager' : 'Member'}</TD>
                      <TD>
                        <WorkloadCell projectId={p._id} personId={m._id} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          <div className="mt-3 flex items-center gap-3">
            <Progress done={p.stats.done} total={p.stats.total} />
          </div>
        </TabsContent>
      </Tabs>

      <TaskDetailDialog taskId={open} onClose={() => setOpen(null)} onEdit={(t) => { setOpen(null); setForm({ task: t }); }} />
      <TaskFormDialog project={p} task={form?.task ?? null} open={!!form} defaultStatus={form?.status} onClose={() => setForm(null)} />
      <ProjectDialog open={editProject} project={p} onClose={() => setEditProject(false)} />
    </>
  );
}

function WorkloadCell({ projectId, personId }: { projectId: string; personId: string }) {
  const { data } = useGet<TaskRow[]>(['projects', 'tasks', projectId, 'person', personId], `/projects/${projectId}/tasks`, { assignee: personId });
  const open = data?.filter((t) => t.status !== 'done').length ?? 0;
  return <span className="tabular-nums">{data ? open : '…'}</span>;
}
