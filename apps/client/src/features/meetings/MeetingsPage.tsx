import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { CalendarDays, ChevronLeft, ChevronRight, List, MapPin, Plus, Search, Video } from 'lucide-react';
import { MEETING_TYPES } from '@cms/shared';
import { useDebounced, useGet } from '@/api/hooks';
import type { Paged } from '@/api/types';
import { cn } from '@/lib/utils';
import { PageHeader, Pager, Spinner } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { MeetingForm } from './MeetingForm';
import { TYPE_TONE, typeLabel, type MeetingRow } from './types';

type List = Paged<MeetingRow> & { seesAll: boolean };

export function MeetingStatusBadge({ status }: { status: string }) {
  const v = status === 'completed' ? 'success' : status === 'cancelled' ? 'destructive' : 'default';
  return (
    <Badge variant={v} className="capitalize">
      {status === 'completed' ? 'held' : status}
    </Badge>
  );
}

export function TypeChip({ type }: { type: string }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', TYPE_TONE[type])}>{typeLabel(type)}</span>;
}

export function MeetingsPage() {
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [creating, setCreating] = useState<{ date?: string } | null>(null);
  return (
    <>
      <PageHeader
        title="Meetings"
        description="Internal, client and site meetings: who, when, agenda, minutes and follow-up actions."
        actions={
          <div className="flex gap-2">
            <div className="flex rounded-md border">
              <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('list')}>
                <List /> List
              </Button>
              <Button variant={view === 'calendar' ? 'secondary' : 'ghost'} size="sm" onClick={() => setView('calendar')}>
                <CalendarDays /> Calendar
              </Button>
            </div>
            <Button onClick={() => setCreating({})}>
              <Plus /> Schedule meeting
            </Button>
          </div>
        }
      />
      {view === 'list' ? <ListView /> : <CalendarView onNew={(date) => setCreating({ date })} />}
      <MeetingForm open={!!creating} defaults={creating ?? undefined} onClose={() => setCreating(null)} />
    </>
  );
}

function ListView() {
  const [view, setView] = useViewMode('meetings');
  const [when, setWhen] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const today = dayjs().format('YYYY-MM-DD');
  const params = {
    page,
    limit: 25,
    q: dq || undefined,
    type: type || undefined,
    scope,
    ...(when === 'upcoming' ? { from: today, order: 'asc' } : when === 'past' ? { to: dayjs().subtract(1, 'day').format('YYYY-MM-DD'), order: 'desc' } : { order: 'desc' }),
  };
  const { data, isLoading } = useGet<List>(['meetings', 'list'], '/meetings', params);
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="w-60 pl-8" placeholder="Search title, place, guests" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        </div>
        <Select className="w-36" value={when} onChange={(e) => (setWhen(e.target.value as typeof when), setPage(1))}>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
          <option value="all">All dates</option>
        </Select>
        <Select className="w-44" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
          <option value="">All types</option>
          {MEETING_TYPES.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </Select>
        {data?.seesAll && (
          <Select className="w-44" value={scope} onChange={(e) => (setScope(e.target.value as typeof scope), setPage(1))}>
            <option value="all">Everyone's meetings</option>
            <option value="mine">Only mine</option>
          </Select>
        )}
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
                  <TH>When</TH>
                  <TH>Meeting</TH>
                  <TH>Type</TH>
                  <TH>Where</TH>
                  <TH>Organiser</TH>
                  <TH>People</TH>
                  <TH>Actions open</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {isLoading && (
                  <TR>
                    <TD colSpan={8}>
                      <Spinner />
                    </TD>
                  </TR>
                )}
                {!isLoading && !data?.items.length && <EmptyRow cols={8} text={when === 'upcoming' ? 'No upcoming meetings.' : 'No meetings found.'} />}
                {data?.items.map((m) => (
                  <TR key={m._id}>
                    <TD className="whitespace-nowrap">
                      <div className="font-medium">{dayjs(m.date).format('ddd DD MMM')}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.start}–{m.end}
                      </div>
                    </TD>
                    <TD>
                      <Link to={`/meetings/${m._id}`} className="font-medium hover:underline">
                        {m.title}
                      </Link>
                      {(m.project || m.client) && (
                        <div className="text-xs text-muted-foreground">{[m.project && `${m.project.code} ${m.project.name}`, m.client?.name].filter(Boolean).join(' · ')}</div>
                      )}
                    </TD>
                    <TD>
                      <TypeChip type={m.type} />
                    </TD>
                    <TD className="max-w-[12rem] text-xs">
                      {m.location && (
                        <div className="flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3 shrink-0" /> {m.location}
                        </div>
                      )}
                      {m.link && (
                        <div className="flex items-center gap-1 text-primary">
                          <Video className="h-3 w-3" /> Online
                        </div>
                      )}
                    </TD>
                    <TD className="text-sm">{m.organizer?.name}</TD>
                    <TD>{m.attendeeCount + 1}</TD>
                    <TD>{m.openActions || '—'}</TD>
                    <TD>
                      <MeetingStatusBadge status={m.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        ) : (
        <CardGrid
          items={data?.items}
          empty={when === 'upcoming' ? 'No upcoming meetings.' : 'No meetings found.'}
          render={(m) => (
            <Card key={m._id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/meetings/${m._id}`} className="block truncate font-medium hover:underline">{m.title}</Link>
                    <div className="text-xs text-muted-foreground">{dayjs(m.date).format('ddd DD MMM')} · {m.start}–{m.end}</div>
                  </div>
                  <MeetingStatusBadge status={m.status} />
                </div>
                <div><TypeChip type={m.type} /></div>
                {m.location && <CardLine label="Where">{m.location}</CardLine>}
                {m.link && <CardLine label="Online"><span className="text-primary">Yes</span></CardLine>}
                <CardLine label="Organiser">{m.organizer?.name}</CardLine>
                <CardLine label="People">{m.attendeeCount + 1}</CardLine>
                {(m.project || m.client) && <CardLine label="Linked">{[m.project?.code, m.client?.name].filter(Boolean).join(' · ')}</CardLine>}
                {!!m.openActions && <CardLine label="Open actions">{m.openActions}</CardLine>}
              </CardContent>
            </Card>
          )}
        />
        )}
      </>
      {data && <Pager page={page} limit={25} total={data.total} onPage={setPage} />}
    </>
  );
}

/** Month grid; click an empty part of a day to schedule on that date. */
function CalendarView({ onNew }: { onNew: (date: string) => void }) {
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const gridStart = month.startOf('week');
  const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const { data } = useGet<List>(['meetings', 'calendar'], '/meetings', {
    from: days[0].format('YYYY-MM-DD'),
    to: days[41].format('YYYY-MM-DD'),
    limit: 500,
    scope,
  });
  const byDay = useMemo(() => {
    const m = new Map<string, MeetingRow[]>();
    for (const x of data?.items ?? []) m.set(x.date, [...(m.get(x.date) ?? []), x]);
    return m;
  }, [data]);
  const today = dayjs().format('YYYY-MM-DD');
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="icon" variant="outline" aria-label="Previous month" onClick={() => setMonth(month.subtract(1, 'month'))}>
            <ChevronLeft />
          </Button>
          <div className="w-36 text-center font-semibold">{month.format('MMMM YYYY')}</div>
          <Button size="icon" variant="outline" aria-label="Next month" onClick={() => setMonth(month.add(1, 'month'))}>
            <ChevronRight />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMonth(dayjs().startOf('month'))}>
            Today
          </Button>
          {data?.seesAll && (
            <Select className="ml-auto w-44" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="all">Everyone's meetings</option>
              <option value="mine">Only mine</option>
            </Select>
          )}
        </div>
        <div className="grid grid-cols-7 border-l border-t text-xs">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="border-b border-r bg-muted/50 px-2 py-1 font-medium text-muted-foreground">
              {d}
            </div>
          ))}
          {days.map((d) => {
            const key = d.format('YYYY-MM-DD');
            const list = byDay.get(key) ?? [];
            const other = d.month() !== month.month();
            return (
              <div
                key={key}
                className={cn('min-h-24 cursor-pointer border-b border-r p-1 hover:bg-accent/40', other && 'bg-muted/30 text-muted-foreground')}
                onClick={(e) => e.target === e.currentTarget && onNew(key)}
                title="Click an empty space to schedule on this day"
              >
                <div className={cn('mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full', key === today && 'bg-primary text-primary-foreground')}>{d.date()}</div>
                <div className="space-y-0.5">
                  {list.slice(0, 4).map((m) => (
                    <Link
                      key={m._id}
                      to={`/meetings/${m._id}`}
                      className={cn('block truncate rounded px-1 py-0.5', TYPE_TONE[m.type], m.status === 'cancelled' && 'line-through opacity-60')}
                      title={`${m.start}–${m.end} ${m.title}`}
                    >
                      {m.start} {m.title}
                    </Link>
                  ))}
                  {list.length > 4 && <div className="px-1 text-muted-foreground">+{list.length - 4} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
