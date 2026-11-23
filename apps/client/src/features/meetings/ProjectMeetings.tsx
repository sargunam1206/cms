import { useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { Plus } from 'lucide-react';
import { useGet } from '@/api/hooks';
import type { Paged } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { MeetingForm } from './MeetingForm';
import { MeetingStatusBadge, TypeChip } from './MeetingsPage';
import type { MeetingRow } from './types';

/** Meetings linked to a project (the ones the viewer may see), newest first, with a quick way to schedule one. */
export function ProjectMeetings({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useGet<Paged<MeetingRow>>(['meetings', 'project', projectId], '/meetings', { project: projectId, order: 'desc', limit: 100 });
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus /> Schedule meeting
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Meeting</TH>
                <TH>Type</TH>
                <TH>Organiser</TH>
                <TH>Actions open</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {!data?.items.length && <EmptyRow cols={6} text="No meetings linked to this project yet." />}
              {data?.items.map((m) => (
                <TR key={m._id}>
                  <TD className="whitespace-nowrap">
                    {dayjs(m.date).format('DD MMM YYYY')}
                    <div className="text-xs text-muted-foreground">
                      {m.start}–{m.end}
                    </div>
                  </TD>
                  <TD>
                    <Link to={`/meetings/${m._id}`} className="font-medium hover:underline">
                      {m.title}
                    </Link>
                  </TD>
                  <TD>
                    <TypeChip type={m.type} />
                  </TD>
                  <TD>{m.organizer?.name}</TD>
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
      <MeetingForm open={open} defaults={{ project: projectId }} onClose={() => setOpen(false)} />
    </>
  );
}
