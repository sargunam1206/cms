import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { Video } from 'lucide-react';
import { useGet } from '@/api/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Meetings today</CardTitle>
        <Link to="/meetings" className="text-sm text-primary hover:underline">
          All meetings →
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!data.today.length && <p className="text-muted-foreground">No meetings today.</p>}
        {data.today.map((m) => (
          <Link key={m._id} to={`/meetings/${m._id}`} className="flex items-center gap-3 rounded-md border p-2 hover:bg-accent/40">
            <div className="w-24 shrink-0 font-medium">
              {m.start}–{m.end}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{m.title}</div>
              <div className="truncate text-xs text-muted-foreground">{m.location}</div>
            </div>
            {m.link && <Video className="h-4 w-4 text-primary" />}
            <TypeChip type={m.type} />
          </Link>
        ))}
        {!!data.actions.length && (
          <div className="border-t pt-3">
            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">My open meeting actions</div>
            {data.actions.slice(0, 5).map((a) => (
              <Link key={a._id} to={`/meetings/${a.meetingId}`} className="block py-0.5 hover:underline">
                {a.text}
                <span className="text-xs text-muted-foreground">
                  {' '}
                  · {a.meeting}
                  {a.dueDate && <span className={a.dueDate < today ? 'font-medium text-red-600' : ''}> · due {dayjs(a.dueDate).format('DD MMM')}</span>}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
