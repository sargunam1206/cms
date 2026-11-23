import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { ArrowLeft, CalendarClock, ExternalLink, MapPin, Pencil, Trash2, Users } from 'lucide-react';
import { useGet, useSend } from '@/api/hooks';
import { PageHeader, Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth';
import { MeetingForm } from './MeetingForm';
import { MeetingStatusBadge, TypeChip } from './MeetingsPage';
import { personId, type MeetingDetail, type Person } from './types';

export function MeetingPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: m, isLoading } = useGet<MeetingDetail>(['meetings', 'one', id], `/meetings/${id}`);
  const [editing, setEditing] = useState(false);
  const status = useSend<string>('patch', `/meetings/${id}/status`, { invalidate: [['meetings']], success: 'Updated', body: (s) => ({ status: s }) });
  const del = useSend('delete', `/meetings/${id}`, { invalidate: [['meetings']], success: 'Meeting deleted', onSuccess: () => nav('/meetings') });
  const tick = useSend<{ actionId: string; done: boolean }>('patch', (v) => `/meetings/${id}/actions/${v.actionId}`, {
    invalidate: [['meetings']],
    body: (v) => ({ done: v.done }),
  });

  if (isLoading || !m) return <Spinner />;
  const me = user?.employee?._id;
  const past = m.date < dayjs().format('YYYY-MM-DD');
  return (
    <>
      <Link to="/meetings" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="h-4 w-4" /> Meetings
      </Link>
      <PageHeader
        title={m.title}
        description={`Organised by ${m.organizer.name}`}
        actions={
          m.canEdit && (
            <div className="flex flex-wrap gap-2">
              {m.status !== 'cancelled' && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil /> {past ? 'Add minutes / edit' : 'Edit'}
                </Button>
              )}
              {m.status === 'scheduled' && (
                <Button variant="outline" disabled={status.isPending} onClick={() => status.mutate('completed')}>
                  Mark as held
                </Button>
              )}
              {m.status === 'scheduled' && (
                <Button variant="outline" disabled={status.isPending} onClick={() => window.confirm('Cancel this meeting? Everyone invited will be told.') && status.mutate('cancelled')}>
                  Cancel meeting
                </Button>
              )}
              {m.status !== 'scheduled' && (
                <Button variant="outline" disabled={status.isPending} onClick={() => status.mutate('scheduled')}>
                  Reopen
                </Button>
              )}
              <Button variant="ghost" className="text-destructive" disabled={del.isPending} onClick={() => window.confirm('Delete this meeting permanently?') && del.mutate(undefined)}>
                <Trash2 /> Delete
              </Button>
            </div>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="space-y-2 pt-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <TypeChip type={m.type} />
                <MeetingStatusBadge status={m.status} />
              </div>
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" /> {dayjs(m.date).format('dddd, DD MMM YYYY')} · {m.start}–{m.end}
              </div>
              {m.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" /> {m.location}
                </div>
              )}
              {m.link && (
                <a href={m.link} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 text-primary hover:underline">
                  <ExternalLink className="h-4 w-4" /> Join online
                </a>
              )}
              {(m.project || m.client) && (
                <div className="text-muted-foreground">
                  Linked to{' '}
                  {m.project && (
                    <Link to={`/projects/${m.project._id}`} className="text-primary hover:underline">
                      {m.project.code} {m.project.name}
                    </Link>
                  )}
                  {m.project && m.client && ' · '}
                  {m.client?.name}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agenda</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm">{m.agenda || <span className="text-muted-foreground">No agenda written.</span>}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Minutes</CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm">
              {m.minutes || <span className="text-muted-foreground">{m.canEdit ? 'No minutes yet. Use "Edit" after the meeting to record what was decided.' : 'No minutes yet.'}</span>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Action items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!m.actions.length && <p className="text-muted-foreground">No action items.</p>}
              {m.actions.map((a) => {
                const owner = a.owner as Person | null;
                const mayTick = m.canEdit || (!!me && personId(owner) === me);
                const overdue = !a.done && a.dueDate && a.dueDate < dayjs().format('YYYY-MM-DD');
                return (
                  <label key={a._id} className="flex items-start gap-2 rounded-md border p-2">
                    <Checkbox className="mt-0.5" checked={a.done} disabled={!mayTick || tick.isPending} onChange={(e) => tick.mutate({ actionId: a._id!, done: e.target.checked })} />
                    <span className="flex-1">
                      <span className={a.done ? 'text-muted-foreground line-through' : ''}>{a.text}</span>
                      <span className="block text-xs text-muted-foreground">
                        {owner?.name ?? 'No owner'}
                        {a.dueDate && <span className={overdue ? 'font-medium text-red-600' : ''}> · due {dayjs(a.dueDate).format('DD MMM')}</span>}
                      </span>
                    </span>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> People
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <div className="font-medium">{m.organizer.name}</div>
              <div className="text-xs text-muted-foreground">Organiser{m.organizer.designation ? ` · ${m.organizer.designation}` : ''}</div>
            </div>
            {m.attendees.map((p) => (
              <div key={p._id}>
                <div>{p.name}</div>
                <div className="text-xs text-muted-foreground">{[p.designation, p.department].filter(Boolean).join(' · ') || p.code}</div>
              </div>
            ))}
            {m.guests && (
              <div className="border-t pt-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">Guests</div>
                <div className="whitespace-pre-wrap">{m.guests}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <MeetingForm open={editing} editing={m} onClose={() => setEditing(false)} />
    </>
  );
}
