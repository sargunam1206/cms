import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { REGULARIZATION_TYPES, regularizationSchema, type RegularizationInput } from '@cms/shared';
import { useSend } from '@/api/hooks';
import type { Regularization } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';

const TYPE_LABEL: Record<string, string> = {
  'missed-checkin': 'Missed check-in',
  'missed-checkout': 'Missed check-out',
  'on-duty': 'On duty / outside work',
};

/** A new request for `date`, or (with `request`) an edit of one of your pending requests. */
export interface RegularizationTarget {
  date: string;
  request?: Regularization;
}

export function RegularizationDialog({ target, onClose }: { target: RegularizationTarget | null; onClose: () => void }) {
  const { register, handleSubmit, reset, formState } = useForm<RegularizationInput>({ resolver: zodResolver(regularizationSchema) });
  const editing = target?.request;
  useEffect(() => {
    if (!target) return;
    const r = target.request;
    reset(
      r
        ? { date: r.date, type: r.type as RegularizationInput['type'], checkIn: r.checkIn ?? '', checkOut: r.checkOut ?? '', reason: r.reason }
        : { date: target.date, type: 'missed-checkin', checkIn: '', checkOut: '', reason: '' },
    );
  }, [target, reset]);

  const send = useSend<RegularizationInput>(editing ? 'put' : 'post', editing ? `/regularizations/${editing._id}` : '/regularizations', {
    invalidate: [['regularizations'], ['dashboard']],
    success: editing ? 'Request updated' : 'Request sent for approval',
    onSuccess: onClose,
  });

  // Empty time inputs mean "not changing that punch"
  const submit = (v: RegularizationInput) => send.mutate({ ...v, checkIn: v.checkIn || undefined, checkOut: v.checkOut || undefined });
  const err = formState.errors as Record<string, { message?: string }>;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit regularization request' : 'Regularize attendance'}</DialogTitle>
          <DialogDescription>Your manager approves this request, and it stays on record.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" error={err.date?.message}>
              <Input type="date" {...register('date')} />
            </Field>
            <Field label="Type">
              <Select {...register('type')}>
                {REGULARIZATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Check-in time" error={err.checkIn?.message}>
              <Input type="time" {...register('checkIn')} />
            </Field>
            <Field label="Check-out time">
              <Input type="time" {...register('checkOut')} />
            </Field>
          </div>
          <Field label="Reason" error={err.reason?.message}>
            <Textarea {...register('reason')} placeholder="e.g. Forgot to check out; client visit at Guindy" />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={send.isPending}>
              {editing ? 'Save changes' : 'Submit'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
