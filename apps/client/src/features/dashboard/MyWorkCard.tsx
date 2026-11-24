import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { AlertOctagon, CalendarClock, ListTodo, Timer } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tile } from './widgets';
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
    <Card className="flex-1">
      <div className="flex items-center justify-between px-5 pt-4">
        <h3 className="text-sm font-semibold">My work</h3>
        <Link to="/my/tasks" className="text-xs font-medium text-primary hover:underline">
          My tasks →
        </Link>
      </div>
      <CardContent className="grid grid-cols-2 gap-1 p-3 sm:grid-cols-4">
        <Tile icon={ListTodo} tone="blue" label="Open tasks" value={open.data?.length ?? '…'} to="/my/tasks" />
        <Tile icon={AlertOctagon} tone={overdue ? 'red' : 'slate'} label="Overdue" value={overdue} to="/my/tasks" />
        <Tile icon={CalendarClock} tone={dueSoon ? 'amber' : 'slate'} label="Due in 2 days" value={dueSoon} to="/my/tasks" />
        <Tile icon={Timer} tone="violet" label="Logged this week" value={week.data ? `${hmFull(week.data.total)} h` : '…'} to="/my/timesheet" />
      </CardContent>
    </Card>
  );
}
