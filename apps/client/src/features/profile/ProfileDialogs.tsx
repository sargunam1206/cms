import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { bankChangeSchema, contactUpdateSchema } from '@cms/shared';
import type { z } from 'zod';
import { useSend } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form-controls';

type PhoneForm = z.infer<typeof contactUpdateSchema>;
type BankForm = z.infer<typeof bankChangeSchema>;

export function EditPhoneDialog({ open, phone, onClose }: { open: boolean; phone?: string; onClose: () => void }) {
  const { register, handleSubmit, formState, reset } = useForm<PhoneForm>({ resolver: zodResolver(contactUpdateSchema) });
  useEffect(() => reset({ phone: phone ?? '' }), [open, phone, reset]);
  const send = useSend<PhoneForm>('put', '/profile/contact', { invalidate: [['profile']], success: 'Phone updated', onSuccess: onClose });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update phone number</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit((v) => send.mutate(v))}>
          <Field label="Phone" error={formState.errors.phone?.message}>
            <Input autoComplete="tel" {...register('phone')} />
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

export function BankChangeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { register, handleSubmit, formState, reset } = useForm<BankForm>({ resolver: zodResolver(bankChangeSchema) });
  useEffect(() => reset({ accountNumber: '', ifsc: '', bankName: '' }), [open, reset]);
  const send = useSend<BankForm>('post', '/profile/bank-changes', {
    invalidate: [['profile']],
    success: 'Sent to HR for approval',
    onSuccess: onClose,
  });
  const e = formState.errors;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request bank detail change</DialogTitle>
          <DialogDescription>Your salary account stays unchanged until HR approves this request.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit((v) => send.mutate(v))}>
          <Field label="Bank name" error={e.bankName?.message}>
            <Input {...register('bankName')} />
          </Field>
          <Field label="Account number" error={e.accountNumber?.message}>
            <Input inputMode="numeric" autoComplete="off" {...register('accountNumber')} />
          </Field>
          <Field label="IFSC" error={e.ifsc?.message}>
            <Input autoComplete="off" {...register('ifsc')} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={send.isPending}>
              Submit for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
