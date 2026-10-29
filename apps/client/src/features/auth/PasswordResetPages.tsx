import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { forgotPasswordSchema, resetPasswordSchema } from '@cms/shared';
import { api, apiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';

function Shell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <ShieldCheck className="mb-2 h-8 w-8 text-primary" />
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {children}
          <p className="mt-4 text-center text-sm">
            <Link to="/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema) });
  const onSubmit = async (v: { email: string }) => {
    setError(null);
    try {
      await api.post('/auth/forgot-password', v);
      setSent(true);
    } catch (e) {
      setError(apiError(e));
    }
  };
  return (
    <Shell title="Forgot password" description="We will email you a link to set a new one">
      {sent ? (
        <p className="text-sm">If that email has an account, a reset link is on its way. It works for 30 minutes.</p>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Field label="Work email" error={formState.errors.email?.message}>
            <Input type="email" autoComplete="username" autoFocus {...register('email')} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ newPassword: string }>({
    resolver: zodResolver(resetPasswordSchema.pick({ newPassword: true })),
  });
  const onSubmit = async (v: { newPassword: string }) => {
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, newPassword: v.newPassword });
      toast.success('Password updated. Please sign in.');
      navigate('/login', { replace: true });
    } catch (e) {
      setError(apiError(e));
    }
  };
  return (
    <Shell title="Set a new password" description="Choose a password of at least 8 characters">
      {token ? (
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <Field label="New password" error={formState.errors.newPassword?.message}>
            <Input type="password" autoComplete="new-password" autoFocus {...register('newPassword')} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
            Update password
          </Button>
        </form>
      ) : (
        <p className="text-sm text-destructive">This reset link is incomplete. Request a new one.</p>
      )}
    </Shell>
  );
}
