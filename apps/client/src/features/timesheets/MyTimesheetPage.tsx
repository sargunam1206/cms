import { useState } from 'react';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { TimesheetGrid } from './TimesheetGrid';

const monday = (d: dayjs.Dayjs) => d.subtract((d.day() + 6) % 7, 'day');

export function MyTimesheetPage() {
  const [week, setWeek] = useState(monday(dayjs()).format('YYYY-MM-DD'));
  const start = dayjs(week);
  const thisWeek = monday(dayjs()).format('YYYY-MM-DD');
  return (
    <>
      <PageHeader
        title="My Timesheet"
        description="Time you spent on tasks. Each day can hold up to the hours you were at work."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setWeek(start.subtract(7, 'day').format('YYYY-MM-DD'))}>
              <ChevronLeft />
            </Button>
            <div className="w-52 text-center text-sm font-medium">
              {start.format('D MMM')} – {start.add(6, 'day').format('D MMM YYYY')}
            </div>
            <Button variant="outline" size="icon" aria-label="Next week" disabled={week >= thisWeek} onClick={() => setWeek(start.add(7, 'day').format('YYYY-MM-DD'))}>
              <ChevronRight />
            </Button>
            {week !== thisWeek && (
              <Button variant="ghost" size="sm" onClick={() => setWeek(thisWeek)}>
                This week
              </Button>
            )}
          </div>
        }
      />
      <TimesheetGrid weekStart={week} />
    </>
  );
}
