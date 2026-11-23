import { useState } from 'react';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Spinner } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { PriorityBadge, TaskDetailDialog } from './TaskDialogs';
import { isOverdue, statusLabel, type TaskRow } from './types';

/** Everything assigned to me, across projects. */
export function MyTasksPage() {
  const [view, setView] = useViewMode('my-tasks');
  const [scope, setScope] = useState('open');
  const { data, isLoading } = useGet<TaskRow[]>(['projects', 'my-tasks'], '/projects/my/tasks', { scope });
  const [open, setOpen] = useState<string | null>(null);
  const today = dayjs().format('YYYY-MM-DD');
  return (
    <>
      <PageHeader
        title="My Tasks"
        description="Tasks assigned to you in all your projects"
        actions={
          <Select className="w-40" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Show">
            <option value="open">Open</option>
            <option value="overdue">Overdue</option>
            <option value="all">All, including done</option>
          </Select>
        }
      />
      {isLoading ? (
        <Spinner />
      ) : (
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
                    <TH>Task</TH>
                    <TH>Project</TH>
                    <TH>Status</TH>
                    <TH>Priority</TH>
                    <TH>Due</TH>
                  </TR>
                </THead>
                <TBody>
                  {!data?.length && <EmptyRow cols={5} text="Nothing assigned to you" />}
                  {data?.map((t) => (
                    <TR key={t._id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(t._id)}>
                      <TD>
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{t.ref}</span>
                        <span className="font-medium">{t.title}</span>
                      </TD>
                      <TD>
                        {t.project && (
                          <Link to={`/projects/${t.project._id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            {t.project.name}
                          </Link>
                        )}
                      </TD>
                      <TD>
                        <Badge variant="outline">{statusLabel(t.status)}</Badge>
                      </TD>
                      <TD>
                        <PriorityBadge priority={t.priority} />
                      </TD>
                      <TD className={isOverdue(t, today) ? 'font-medium text-red-700' : ''}>{fmtDate(t.dueDate)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          ) : (
          <CardGrid
            items={data}
            empty="Nothing assigned to you."
            render={(t) => (
              <Card key={t._id} className="cursor-pointer hover:shadow-md" onClick={() => setOpen(t._id)}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-muted-foreground">{t.ref}</div>
                      <div className="font-medium">{t.title}</div>
                    </div>
                    <PriorityBadge priority={t.priority} />
                  </div>
                  <CardLine label="Project">
                    {t.project && (
                      <Link to={`/projects/${t.project._id}`} className="text-primary hover:underline" onClick={(ev) => ev.stopPropagation()}>{t.project.name}</Link>
                    )}
                  </CardLine>
                  <CardLine label="Status"><Badge variant="outline">{statusLabel(t.status)}</Badge></CardLine>
                  <CardLine label="Due"><span className={isOverdue(t, today) ? 'font-medium text-red-700' : ''}>{fmtDate(t.dueDate)}</span></CardLine>
                </CardContent>
              </Card>
            )}
          />
          )}
        </>
      )}
      <TaskDetailDialog taskId={open} onClose={() => setOpen(null)} />
    </>
  );
}
