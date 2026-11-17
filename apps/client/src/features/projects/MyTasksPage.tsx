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
import { PriorityBadge, TaskDetailDialog } from './TaskDialogs';
import { isOverdue, statusLabel, type TaskRow } from './types';

/** Everything assigned to me, across projects. */
export function MyTasksPage() {
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
      )}
      <TaskDetailDialog taskId={open} onClose={() => setOpen(null)} />
    </>
  );
}
