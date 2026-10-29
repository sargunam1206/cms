import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary/10 text-primary',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      success: 'border-transparent bg-emerald-100 text-emerald-800',
      warning: 'border-transparent bg-amber-100 text-amber-800',
      destructive: 'border-transparent bg-red-100 text-red-800',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const STATUS_VARIANT: Record<string, VariantProps<typeof badgeVariants>['variant']> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'secondary',
  active: 'success',
  disabled: 'secondary',
  notice: 'warning',
  exited: 'secondary',
};

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge variant={STATUS_VARIANT[status] ?? 'outline'} className="capitalize">
    {status}
  </Badge>
);
