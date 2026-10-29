import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema } from '@cms/shared';
import type { z } from 'zod';
import { useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form-controls';

type Form = z.infer<typeof changePasswordSchema>;

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { logout } = useAuth();
  const { register, handleSubmit, formState, reset } = useForm<Form>({ resolver: zodResolver(changePasswordSchema) });
  const send = useSend<Form>('post', '/auth/change-password', {
    success: 'Password changed. Please sign in again.',
    onSuccess: () => {
      reset();
      onOpenChange(false);
      logout();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit((v) => send.mutate(v))}>
          <Field label="Current password" error={formState.errors.currentPassword?.message}>
            <Input type="password" autoComplete="current-password" {...register('currentPassword')} />
          </Field>
          <Field label="New password" error={formState.errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" {...register('newPassword')} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={send.isPending}>
              Update
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
