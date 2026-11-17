import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { Stat } from '@/components/common/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { hmFull, type Week } from '@/features/timesheets/TimesheetGrid';
import type { TaskRow } from '@/features/projects/types';

/** Home-page summary of my tasks and this week's logged time. */
export function MyWorkCard() {
  const open = useGet<TaskRow[]>(['projects', 'my-tasks', 'open'], '/projects/my/tasks', { scope: 'open' });
  const week = useGet<Week>(['timesheets', 'week', 'home'], '/timesheets/week');
  const today = dayjs().format('YYYY-MM-DD');
  const overdue = open.data?.filter((t) => t.dueDate && t.dueDate < today).length ?? 0;
  const dueSoon = open.data?.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= dayjs().add(2, 'day').format('YYYY-MM-DD')).length ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">My work</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link to="/my/tasks" className="block">
          <Stat label="Open tasks" value={open.data?.length ?? '…'} />
        </Link>
        <Link to="/my/tasks" className="block">
          <Stat label="Overdue" value={overdue} tone={overdue ? 'bad' : undefined} />
        </Link>
        <Link to="/my/tasks" className="block">
          <Stat label="Due in 2 days" value={dueSoon} tone={dueSoon ? 'warn' : undefined} />
        </Link>
        <Link to="/my/timesheet" className="block">
          <Stat label="Logged this week" value={week.data ? `${hmFull(week.data.total)} h` : '…'} />
        </Link>
      </CardContent>
    </Card>
  );
}
