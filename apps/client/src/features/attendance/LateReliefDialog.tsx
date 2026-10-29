import { useEffect, useState } from 'react';
import { useSend } from '@/api/hooks';
import type { EmployeeRef } from '@/api/types';
import { fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form-controls';

export interface LateReliefTarget {
  employee: EmployeeRef;
  dates: string[];
  /** true = excuse the late marks, false = put them back. */
  excused: boolean;
}

/** HR/Admin: excuse (or restore) late marks so they do not count towards late-mark LOP. */
export function LateReliefDialog({ target, onClose }: { target: LateReliefTarget | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [target]);

  const send = useSend('post', '/attendance/late-relief', {
    invalidate: [['attendance'], ['dashboard']],
    success: target?.excused ? 'Late marks excused' : 'Late marks restored',
    onSuccess: onClose,
    body: () => ({ employee: target?.employee._id, dates: target?.dates, excused: target?.excused, reason }),
  });
  const n = target?.dates.length ?? 0;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.excused ? 'Excuse late mark' : 'Restore late mark'}{n > 1 ? 's' : ''}</DialogTitle>
          <DialogDescription>
            {target?.employee.name} ·{' '}
            {n <= 3 ? target?.dates.map((d) => fmtDate(d)).join(', ') : `${n} days`}.{' '}
            {target?.excused
              ? 'The lateness stays on record, but these days will not count towards late-mark loss of pay.'
              : 'These days will count towards late-mark loss of pay again.'}
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bus strike; approved by manager" />
        </Field>
        <DialogFooter>
          <Button disabled={reason.trim().length < 5 || send.isPending} onClick={() => send.mutate(undefined)}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
