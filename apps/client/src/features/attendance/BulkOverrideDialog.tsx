import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { attendanceBulkOverrideSchema, type AttendanceBulkOverrideInput } from '@cms/shared';
import { useSend } from '@/api/hooks';
import type { BulkOverrideResult, EmployeeRef } from '@/api/types';
import { fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';

const clean = (v: AttendanceBulkOverrideInput) => ({ ...v, checkIn: v.checkIn || undefined, checkOut: v.checkOut || undefined });

/**
 * HR/Admin: mark one or many employees over a date range. Step 1 is a dry run that shows what
 * would change and what would be skipped; nothing is written until the user confirms in step 2.
 */
export function BulkOverrideDialog({
  open,
  employees,
  defaultDate,
  onClose,
}: {
  open: boolean;
  employees: EmployeeRef[];
  defaultDate: string;
  onClose: () => void;
}) {
  const { register, handleSubmit, reset, formState } = useForm<AttendanceBulkOverrideInput>({ resolver: zodResolver(attendanceBulkOverrideSchema) });
  const [values, setValues] = useState<AttendanceBulkOverrideInput | null>(null);
  const [preview, setPreview] = useState<BulkOverrideResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    reset({ employees: employees.map((e) => e._id), from: defaultDate, to: defaultDate, status: 'present', checkIn: '', checkOut: '', reason: '' });
  }, [open, employees, defaultDate, reset]);

  const review = useSend<AttendanceBulkOverrideInput, BulkOverrideResult>('post', '/attendance/override/bulk', {
    body: (v) => ({ ...clean(v), dryRun: true }),
    onSuccess: setPreview,
  });
  const apply = useSend<AttendanceBulkOverrideInput, BulkOverrideResult>('post', '/attendance/override/bulk', {
    invalidate: [['attendance'], ['dashboard']],
    body: (v) => ({ ...clean(v), dryRun: false }),
    onSuccess: (r) => {
      toast(`${r.updated} day${r.updated === 1 ? '' : 's'} updated${r.skippedCount ? `, ${r.skippedCount} skipped` : ''}`);
      onClose();
    },
  });

  const e = formState.errors;
  const names = employees.length <= 3 ? employees.map((x) => x.name).join(', ') : `${employees.length} employees`;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark attendance in bulk</DialogTitle>
          <DialogDescription>
            {names}. Overrides the calculated status; each day is recorded in the audit log with your reason.
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <form
            className="space-y-4"
            onSubmit={handleSubmit((v) => {
              setValues(v);
              review.mutate(v);
            })}
          >
            {e.employees && <p className="text-xs text-destructive">{e.employees.message}</p>}
            <Field label="Mark as">
              <Select {...register('status')}>
                <option value="present">Present</option>
                <option value="half">Half day</option>
                <option value="absent">Absent</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" error={e.from?.message}>
                <Input type="date" {...register('from')} />
              </Field>
              <Field label="To" error={e.to?.message}>
                <Input type="date" {...register('to')} />
              </Field>
              <Field label="Check-in (optional)" error={e.checkIn?.message}>
                <Input type="time" {...register('checkIn')} />
              </Field>
              <Field label="Check-out (optional)" error={e.checkOut?.message}>
                <Input type="time" {...register('checkOut')} />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Week-offs, holidays, future dates, locked months, approved leave and your own attendance are skipped automatically.
            </p>
            <Field label="Reason (applies to every day)" error={e.reason?.message}>
              <Textarea {...register('reason')} placeholder="e.g. Office closed for power outage; everyone worked remotely" />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={review.isPending}>
                Review
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <div>
                Will mark <span className="font-semibold">{preview.updated}</span> day{preview.updated === 1 ? '' : 's'} as{' '}
                <span className="font-semibold">{values?.status}</span> across <span className="font-semibold">{preview.people}</span>{' '}
                {preview.people === 1 ? 'person' : 'people'} ({fmtDate(values?.from)}
                {values?.from !== values?.to && <> – {fmtDate(values?.to)}</>}).
              </div>
              {preview.skippedCount > 0 && (
                <div className="mt-3">
                  <div className="font-medium">{preview.skippedCount} skipped</div>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {Object.entries(preview.skippedByReason).map(([reason, n]) => (
                      <li key={reason}>
                        {reason}: {n}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {preview.updated === 0 && <p className="text-sm text-destructive">Nothing would change. Go back and adjust the dates or selection.</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={apply.isPending}>
                Back
              </Button>
              <Button onClick={() => values && apply.mutate(values)} disabled={apply.isPending || preview.updated === 0}>
                Apply to {preview.updated} day{preview.updated === 1 ? '' : 's'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
