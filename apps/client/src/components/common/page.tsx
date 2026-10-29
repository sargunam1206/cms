import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import dayjs from 'dayjs';
import { Button } from '@/components/ui/button';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const Spinner = () => (
  <div className="flex justify-center py-10 text-muted-foreground">
    <Loader2 className="h-5 w-5 animate-spin" />
  </div>
);

export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const shift = (n: number) => onChange(dayjs(`${value}-01`).add(n, 'month').format('YYYY-MM'));
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
        <ChevronLeft />
      </Button>
      <div className="w-32 text-center text-sm font-medium">{dayjs(`${value}-01`).format('MMMM YYYY')}</div>
      <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next month">
        <ChevronRight />
      </Button>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : '';
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

/** Previous/next controls for server-paged lists; renders nothing when everything fits on one page. */
export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}
