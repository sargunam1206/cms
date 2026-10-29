import { useState } from 'react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import type { EmployeeRef, LeaveRequest, Regularization } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Pending {
  kind: 'leave' | 'regularization';
  id: string;
  decision: 'approved' | 'rejected';
  title: string;
}

const empName = (e: string | EmployeeRef) => (typeof e === 'string' ? e : `${e.name} (${e.code})`);

export function ApprovalsPage() {
  const { can } = useAuth();
  const [pending, setPending] = useState<Pending | null>(null);
  const [comment, setComment] = useState('');
  const canLeave = can(P.LEAVE_APPROVE);
  const canReg = can(P.REGULARIZATION_APPROVE);

  const leaves = useGet<LeaveRequest[]>(['leave', 'requests', 'pending'], '/leave/requests/pending', undefined, canLeave);
  const regs = useGet<Regularization[]>(['regularizations', 'pending'], '/regularizations/pending', undefined, canReg);

  const decide = useSend<Pending & { comment: string }>(
    'post',
    (v) => (v.kind === 'leave' ? `/leave/requests/${v.id}/decision` : `/regularizations/${v.id}/decision`),
    {
      invalidate: [['leave'], ['regularizations'], ['attendance'], ['dashboard']],
      body: (v) => ({ decision: v.decision, comment: v.comment || undefined }),
      success: 'Done',
      onSuccess: () => {
        setPending(null);
        setComment('');
      },
    },
  );

  const actions = (p: Omit<Pending, 'decision'>) => (
    <div className="flex justify-end gap-2">
      <Button size="sm" onClick={() => setPending({ ...p, decision: 'approved' })}>
        Approve
      </Button>
      <Button size="sm" variant="outline" onClick={() => setPending({ ...p, decision: 'rejected' })}>
        Reject
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader title="Approvals" description="Requests from people you approve for" />
      <Tabs defaultValue={canLeave ? 'leave' : 'reg'}>
        <TabsList>
          {canLeave && <TabsTrigger value="leave">Leave ({leaves.data?.length ?? 0})</TabsTrigger>}
          {canReg && <TabsTrigger value="reg">Regularization ({regs.data?.length ?? 0})</TabsTrigger>}
        </TabsList>
        {canLeave && (
          <TabsContent value="leave">
            <Table className="rounded-lg border bg-card">
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Type</TH>
                  <TH>Dates</TH>
                  <TH>Days</TH>
                  <TH>Reason</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {!leaves.data?.length && <EmptyRow cols={6} text="No pending leave" />}
                {leaves.data?.map((r) => (
                  <TR key={r._id}>
                    <TD>{empName(r.employee)}</TD>
                    <TD>{r.leaveType?.code}</TD>
                    <TD>
                      {fmtDate(r.from)}
                      {r.to !== r.from && <> – {fmtDate(r.to)}</>}
                      {r.halfDay && ' (half)'}
                    </TD>
                    <TD>{r.days}</TD>
                    <TD className="max-w-xs">{r.reason}</TD>
                    <TD>{actions({ kind: 'leave', id: r._id, title: `${r.leaveType?.code} for ${empName(r.employee)}` })}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TabsContent>
        )}
        {canReg && (
          <TabsContent value="reg">
            <Table className="rounded-lg border bg-card">
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Date</TH>
                  <TH>Type</TH>
                  <TH>In / Out</TH>
                  <TH>Reason</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {!regs.data?.length && <EmptyRow cols={6} text="No pending regularizations" />}
                {regs.data?.map((r) => (
                  <TR key={r._id}>
                    <TD>{empName(r.employee)}</TD>
                    <TD>{fmtDate(r.date)}</TD>
                    <TD className="capitalize">{r.type.replace('-', ' ')}</TD>
                    <TD>
                      {r.checkIn ?? '—'} / {r.checkOut ?? '—'}
                    </TD>
                    <TD className="max-w-xs">{r.reason}</TD>
                    <TD>{actions({ kind: 'regularization', id: r._id, title: `regularization for ${empName(r.employee)}` })}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">
              {pending?.decision === 'approved' ? 'Approve' : 'Reject'} {pending?.title}
            </DialogTitle>
          </DialogHeader>
          <Field label="Comment (optional)">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button
              variant={pending?.decision === 'rejected' ? 'destructive' : 'default'}
              disabled={decide.isPending}
              onClick={() => pending && decide.mutate({ ...pending, comment })}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
