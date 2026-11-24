import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { CalendarClock, CheckSquare, Coffee, Video } from 'lucide-react';
import { useGet } from '@/api/hooks';
import { DashCard } from '@/features/dashboard/widgets';
import { TypeChip } from './MeetingsPage';

interface MyDay {
  today: { _id: string; title: string; type: string; start: string; end: string; location?: string; link?: string; status: string }[];
  actions: { _id: string; meetingId: string; meeting: string; text: string; dueDate?: string | null }[];
}

/** Home-page card: my meetings today and the meeting actions waiting on me. */
export function MyMeetingsCard() {
  const { data } = useGet<MyDay>(['meetings', 'my-day'], '/meetings/my-day');
  if (!data) return null;
  const today = dayjs().format('YYYY-MM-DD');
  return (
    <DashCard title="Today's meetings" icon={CalendarClock} tone="violet" action={{ to: '/meetings', label: 'All meetings' }}>
      {!data.today.length ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <Coffee className="h-5 w-5 shrink-0" /> No meetings today.
        </div>
      ) : (
        <ol className="relative ml-1 space-y-3 border-l-2 border-violet-200 pl-4 text-sm">
          {data.today.map((m) => (
            <li key={m._id} className="relative">
              <span className="absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 border-background bg-violet-500" />
              <Link to={`/meetings/${m._id}`} className="block rounded-md hover:bg-accent/40">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{m.start}</span>–{m.end}
                  {m.link && <Video className="h-3.5 w-3.5 text-primary" />}
                  <TypeChip type={m.type} />
                </div>
                <div className="truncate font-medium">{m.title}</div>
                {m.location && <div className="truncate text-xs text-muted-foreground">{m.location}</div>}
              </Link>
            </li>
          ))}
        </ol>
      )}
      {!!data.actions.length && (
        <div className="mt-4 border-t pt-3 text-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">My open meeting actions</div>
          {data.actions.slice(0, 5).map((a) => (
            <Link key={a._id} to={`/meetings/${a.meetingId}`} className="flex items-start gap-2 py-1 hover:underline">
              <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                {a.text}
                <span className="text-xs text-muted-foreground">
                  {' '}
                  · {a.meeting}
                  {a.dueDate && <span className={a.dueDate < today ? 'font-medium text-red-600' : ''}> · due {dayjs(a.dueDate).format('DD MMM')}</span>}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </DashCard>
  );
}
