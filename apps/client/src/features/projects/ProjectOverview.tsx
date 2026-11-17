import dayjs from 'dayjs';
import { useGet } from '@/api/hooks';
import { fmtDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { VarianceCard } from '@/features/estimates/VarianceCard';
import { PriorityBadge } from './TaskDialogs';
import type { EmployeeRef } from '@/api/types';

interface Item {
  _id: string;
  ref: string;
  title: string;
  dueDate: string;
  priority: string;
  assignee?: EmployeeRef | null;
}
interface Dash {
  hours: { loggedMinutes: number; estimateHours: number; budgetHours: number | null };
  byPerson: { employee: EmployeeRef; openTasks: number; doneTasks: number; estimateHours: number; loggedMinutes: number }[];
  overdue: Item[];
  upcoming: Item[];
  weeks: { weekStart: string; minutes: number }[];
}

const hours = (m: number) => `${(m / 60).toFixed(m % 60 ? 1 : 0)} h`;

/** Hours against the estimate, weekly effort, workload per person, and what is late or coming up. */
export function ProjectOverview({ projectId }: { projectId: string }) {
  const { data } = useGet<Dash>(['projects', 'dashboard', projectId], `/projects/${projectId}/dashboard`);
  if (!data) return null;
  const logged = data.hours.loggedMinutes / 60;
  const planned = data.hours.budgetHours ?? data.hours.estimateHours;
  const over = planned > 0 && logged > planned;
  const pct = planned > 0 ? Math.min(100, (logged / planned) * 100) : 0;
  const peak = Math.max(60, ...data.weeks.map((w) => w.minutes));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <VarianceCard projectId={projectId} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hours logged</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold tabular-nums">{hours(data.hours.loggedMinutes)}</span>
            <span className="text-sm text-muted-foreground">
              of {planned ? `${planned} h ${data.hours.budgetHours ? 'budget' : 'estimated'}` : 'no estimate yet'}
            </span>
          </div>
          {planned > 0 && (
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Hours used">
              <div className={over ? 'h-full bg-red-600' : 'h-full bg-primary'} style={{ width: `${pct}%` }} />
            </div>
          )}
          {over && <p className="text-sm text-red-700">{(logged - planned).toFixed(1)} h over {data.hours.budgetHours ? 'budget' : 'the estimate'}.</p>}
          <div>
            <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">Last 8 weeks</h4>
            <div className="flex h-24 items-end gap-1" role="img" aria-label="Hours logged per week">
              {data.weeks.map((w) => (
                <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1" title={`Week of ${fmtDate(w.weekStart)}: ${hours(w.minutes)}`}>
                  <div className="w-full rounded-t bg-primary/70" style={{ height: `${(w.minutes / peak) * 80}px`, minHeight: w.minutes ? 2 : 0 }} />
                  <span className="text-[10px] text-muted-foreground">{dayjs(w.weekStart).format('D/M')}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workload by person</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Open</TH>
                <TH>Done</TH>
                <TH>Estimate</TH>
                <TH>Logged</TH>
              </TR>
            </THead>
            <TBody>
              {!data.byPerson.length && <EmptyRow cols={5} text="No tasks assigned yet" />}
              {data.byPerson.map((r) => (
                <TR key={r.employee._id}>
                  <TD className="font-medium">{r.employee.name}</TD>
                  <TD className="tabular-nums">{r.openTasks}</TD>
                  <TD className="tabular-nums">{r.doneTasks}</TD>
                  <TD className="tabular-nums">{r.estimateHours ? `${r.estimateHours} h` : '—'}</TD>
                  <TD className="tabular-nums">{hours(r.loggedMinutes)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <DueList title="Overdue" tone="text-red-700" items={data.overdue} empty="Nothing is overdue" />
      <DueList title="Due in the next 7 days" items={data.upcoming} empty="Nothing due this week" />
    </div>
  );
}

function DueList({ title, items, empty, tone }: { title: string; items: Item[]; empty: string; tone?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title} <span className="ml-1 text-sm font-normal text-muted-foreground">{items.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!items.length && <p className="px-4 pb-4 text-sm text-muted-foreground">{empty}</p>}
        <ul>
          {items.map((t) => (
            <li key={t._id} className="flex items-center justify-between gap-3 border-t px-4 py-2 text-sm">
              <span>
                <span className="mr-2 font-mono text-xs text-muted-foreground">{t.ref}</span>
                {t.title}
                <span className="block text-xs text-muted-foreground">{t.assignee?.name ?? 'Unassigned'}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <PriorityBadge priority={t.priority} />
                <span className={tone}>{fmtDate(t.dueDate)}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
