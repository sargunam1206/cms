import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { loginSchema, type LoginInput } from '@cms/shared';
import { apiError } from '@/api/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (v: LoginInput) => {
    setError(null);
    try {
      await login(v.email, v.password);
      navigate('/', { replace: true });
    } catch (e) {
      setError(apiError(e));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <ShieldCheck className="mb-2 h-8 w-8 text-primary" />
          <CardTitle className="text-xl">Company Management System</CardTitle>
          <CardDescription>Sign in with your work email</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <Field label="Email" error={formState.errors.email?.message}>
              <Input type="email" autoComplete="username" autoFocus {...register('email')} />
            </Field>
            <Field label="Password" error={formState.errors.password?.message}>
              <Input type="password" autoComplete="current-password" {...register('password')} />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
              Sign in
            </Button>
            <p className="text-center text-sm">
              <Link to="/forgot-password" className="text-primary hover:underline">
                Forgot password?
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
