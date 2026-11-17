import { useState } from 'react';
import dayjs from 'dayjs';
import { useGet, useSend } from '@/api/hooks';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { TimesheetGrid, hmFull } from './TimesheetGrid';

interface Pending {
  _id: string;
  weekStart: string;
  totalMinutes: number;
  submittedAt: string;
  employee: { _id: string; name: string; code: string };
}

/** Submitted weeks waiting for the manager (or HR). Open one to see the grid, then approve or send it back. */
export function TimesheetApprovalsPage() {
  const { data } = useGet<Pending[]>(['timesheets', 'pending'], '/timesheets/pending');
  const [open, setOpen] = useState<Pending | null>(null);
  const [back, setBack] = useState(false);
  const [comment, setComment] = useState('');
  const decide = useSend<'approved' | 'rejected'>('post', `/timesheets/${open?._id}/decision`, {
    invalidate: [['timesheets']],
    body: (decision) => ({ decision, comment: comment || undefined }),
    success: 'Done',
    onSuccess: () => {
      setOpen(null);
      setBack(false);
      setComment('');
    },
  });
  return (
    <>
      <PageHeader title="Timesheet approvals" description="Weeks submitted by the people you approve for" />
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Week</TH>
                <TH>Total</TH>
                <TH>Submitted</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!data?.length && <EmptyRow cols={5} text="Nothing waiting for you" />}
              {data?.map((s) => (
                <TR key={s._id}>
                  <TD className="font-medium">
                    {s.employee.name} <span className="text-xs text-muted-foreground">{s.employee.code}</span>
                  </TD>
                  <TD>
                    {dayjs(s.weekStart).format('D MMM')} – {dayjs(s.weekStart).add(6, 'day').format('D MMM YYYY')}
                  </TD>
                  <TD className="tabular-nums">{hmFull(s.totalMinutes)} h</TD>
                  <TD>{dayjs(s.submittedAt).format('DD MMM, hh:mm A')}</TD>
                  <TD className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpen(s)}>
                      Review
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!open} onOpenChange={(o) => !o && (setOpen(null), setBack(false))}>
        <DialogContent className="max-w-5xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.employee.name}</DialogTitle>
                <DialogDescription>
                  Week of {dayjs(open.weekStart).format('D MMM YYYY')} · {hmFull(open.totalMinutes)} h logged
                </DialogDescription>
              </DialogHeader>
              <TimesheetGrid employeeId={open.employee._id} weekStart={open.weekStart} readOnly />
              {back && (
                <Field label="What needs correcting?">
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
              )}
              <DialogFooter>
                {!back ? (
                  <>
                    <Button variant="outline" onClick={() => setBack(true)}>
                      Send back
                    </Button>
                    <Button disabled={decide.isPending} onClick={() => decide.mutate('approved')}>
                      Approve
                    </Button>
                  </>
                ) : (
                  <Button variant="destructive" disabled={comment.trim().length < 3 || decide.isPending} onClick={() => decide.mutate('rejected')}>
                    Send back to employee
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
