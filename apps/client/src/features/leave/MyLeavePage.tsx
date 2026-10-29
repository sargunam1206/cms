import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { leaveRequestSchema, type LeaveRequestInput } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import type { LeaveBalance, LeaveRequest, LeaveType } from '@/api/types';
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/common/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export function MyLeavePage() {
  const year = dayjs().year();
  const [editing, setEditing] = useState<LeaveRequest | 'new' | null>(null);
  const balances = useGet<LeaveBalance[]>(['leave', 'balances', 'me'], '/leave/balances/me', { year });
  const requests = useGet<LeaveRequest[]>(['leave', 'requests', 'mine'], '/leave/requests/mine');
  const cancel = useSend<string>('post', (id) => `/leave/requests/${id}/cancel`, {
    invalidate: [['leave'], ['attendance'], ['dashboard']],
    success: 'Leave cancelled',
    body: () => ({}),
  });
  const today = dayjs().format('YYYY-MM-DD');

  return (
    <>
      <PageHeader
        title="My Leave"
        description={`Balances for ${year}`}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Apply leave
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {balances.data?.map((b) => (
          <Card key={b.leaveType._id}>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">{b.leaveType.name}</div>
              <div className="mt-1 text-2xl font-semibold">{b.available}</div>
              <div className="mt-2 text-xs text-muted-foreground">
                {b.opening > 0 && <>Carried {b.opening} · </>}Accrued {b.accrued}
                {b.adjustment !== 0 && <> · Adj {b.adjustment}</>} · Used {b.used}
                {b.pending > 0 && <> · Pending {b.pending}</>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">My requests</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Type</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>Days</TH>
                <TH>Reason</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!requests.data?.length && <EmptyRow cols={7} />}
              {requests.data?.map((r) => (
                <TR key={r._id}>
                  <TD>{r.leaveType?.code}</TD>
                  <TD>{fmtDate(r.from)}</TD>
                  <TD>{fmtDate(r.to)}</TD>
                  <TD>{r.days}</TD>
                  <TD className="max-w-xs truncate" title={r.reason}>
                    {r.reason}
                    {r.comment && <div className="text-xs text-muted-foreground">Note: {r.comment}</div>}
                  </TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="whitespace-nowrap text-right">
                    {r.status === 'pending' && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                    )}
                    {(r.status === 'pending' || (r.status === 'approved' && r.from > today)) && (
                      <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r._id)}>
                        Cancel
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <LeaveDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Apply a new leave, or edit one of your pending requests. */
function LeaveDialog({ editing, onClose }: { editing: LeaveRequest | 'new' | null; onClose: () => void }) {
  const isNew = editing === 'new';
  const types = useGet<LeaveType[]>(['leave', 'types'], '/leave/types');
  const today = dayjs().format('YYYY-MM-DD');
  const { register, handleSubmit, watch, reset, formState } = useForm<LeaveRequestInput>({ resolver: zodResolver(leaveRequestSchema) });

  useEffect(() => {
    if (!editing) return;
    if (editing === 'new') reset({ leaveType: '', from: today, to: today, halfDay: false, reason: '' });
    else reset({ leaveType: editing.leaveType._id, from: editing.from, to: editing.to, halfDay: editing.halfDay, reason: editing.reason });
  }, [editing, today, reset]);

  const send = useSend<LeaveRequestInput>(isNew ? 'post' : 'put', isNew ? '/leave/requests' : `/leave/requests/${editing?._id ?? ''}`, {
    invalidate: [['leave'], ['dashboard']],
    success: isNew ? 'Leave applied' : 'Leave request updated',
    onSuccess: onClose,
  });
  const selected = types.data?.find((t) => t._id === watch('leaveType'));

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? 'Apply leave' : 'Edit leave request'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit((v) => send.mutate(v))}>
          <Field label="Leave type" error={formState.errors.leaveType?.message}>
            <Select {...register('leaveType')}>
              <option value="" disabled>
                Select…
              </option>
              {types.data?.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" error={formState.errors.from?.message}>
              <Input type="date" {...register('from')} />
            </Field>
            <Field label="To" error={formState.errors.to?.message}>
              <Input type="date" {...register('to')} />
            </Field>
          </div>
          {selected?.allowHalfDay !== false && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('halfDay')} /> Half day
            </label>
          )}
          {formState.errors.halfDay && <p className="text-xs text-destructive">{formState.errors.halfDay.message}</p>}
          <p className="text-xs text-muted-foreground">Week-offs and holidays within the range are not counted.</p>
          <Field label="Reason" error={formState.errors.reason?.message}>
            <Textarea {...register('reason')} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={send.isPending}>
              {isNew ? 'Apply' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
