import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { attendanceOverrideSchema, type AttendanceOverrideInput } from '@cms/shared';
import { useSend } from '@/api/hooks';
import type { EmployeeRef } from '@/api/types';
import { fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';

export interface OverrideTarget {
  employee: EmployeeRef;
  date: string;
}

/** HR/Admin direct correction of one employee-day. Recorded in the audit log with the reason. */
export function OverrideDialog({ target, onClose }: { target: OverrideTarget | null; onClose: () => void }) {
  const { register, handleSubmit, reset, formState } = useForm<AttendanceOverrideInput>({ resolver: zodResolver(attendanceOverrideSchema) });
  useEffect(() => {
    if (target) reset({ employee: target.employee._id, date: target.date, status: 'present', checkIn: '', checkOut: '', reason: '' });
  }, [target, reset]);

  const send = useSend<AttendanceOverrideInput>('post', '/attendance/override', {
    invalidate: [['attendance'], ['dashboard']],
    success: 'Attendance updated',
    onSuccess: onClose,
    body: (v) => ({ ...v, checkIn: v.checkIn || undefined, checkOut: v.checkOut || undefined }),
  });
  const e = formState.errors;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark attendance</DialogTitle>
          <DialogDescription>
            {target?.employee.name} ({target?.employee.code}) · {fmtDate(target?.date)}. This overrides the calculated status and is recorded in the audit
            log.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit((v) => send.mutate(v))}>
          <Field label="Mark as">
            <Select {...register('status')}>
              <option value="present">Present</option>
              <option value="half">Half day</option>
              <option value="absent">Absent</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Check-in (optional)" error={e.checkIn?.message}>
              <Input type="time" {...register('checkIn')} />
            </Field>
            <Field label="Check-out (optional)" error={e.checkOut?.message}>
              <Input type="time" {...register('checkOut')} />
            </Field>
          </div>
          <Field label="Reason" error={e.reason?.message}>
            <Textarea {...register('reason')} placeholder="e.g. Worked from client site; confirmed by manager" />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={send.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
