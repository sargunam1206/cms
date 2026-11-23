import { useState, type ReactNode } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export type ViewMode = 'list' | 'grid';

/** List or grid, remembered per page in this browser (falls back to list when storage is unavailable). */
export function useViewMode(page: string, initial: ViewMode = 'list') {
  const key = `view:${page}`;
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === 'grid' || v === 'list' ? v : initial;
    } catch {
      return initial;
    }
  });
  const change = (m: ViewMode) => {
    setMode(m);
    try {
      localStorage.setItem(key, m);
    } catch {
      /* private window: just don't remember */
    }
  };
  return [mode, change] as const;
}

export function ViewToggle({ mode, onChange, className }: { mode: ViewMode; onChange: (m: ViewMode) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-md border bg-background', className)} role="group" aria-label="View">
      <Button type="button" size="sm" variant={mode === 'list' ? 'secondary' : 'ghost'} aria-pressed={mode === 'list'} aria-label="List view" title="List view" onClick={() => onChange('list')}>
        <List />
      </Button>
      <Button type="button" size="sm" variant={mode === 'grid' ? 'secondary' : 'ghost'} aria-pressed={mode === 'grid'} aria-label="Grid view" title="Grid view" onClick={() => onChange('grid')}>
        <LayoutGrid />
      </Button>
    </div>
  );
}

/** Responsive card grid with the same empty message the tables use. */
export function CardGrid<T>({ items, empty, render, className }: { items: T[] | undefined; empty: string; render: (item: T) => ReactNode; className?: string }) {
  if (!items?.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">{empty}</CardContent>
      </Card>
    );
  }
  return <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}>{items.map(render)}</div>;
}

/** A small label/value line used inside grid cards. */
export function CardLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{children}</span>
    </div>
  );
}
