import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Small building blocks for the dashboard, so each card can take a different shape:
 * icon tiles, list rows, meters and segmented bars. Text always stays in text colours;
 * colour lives on the icon chip or the bar beside it.
 */

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate';
const CHIP: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-700',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  violet: 'bg-violet-50 text-violet-700',
  slate: 'bg-slate-100 text-slate-600',
};

export function IconChip({ icon: Icon, tone = 'blue', className }: { icon: LucideIcon; tone?: Tone; className?: string }) {
  return (
    <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', CHIP[tone], className)}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** A card with an icon in its heading and an optional "view all" link on the right. */
export function DashCard({ title, icon, tone = 'blue', action, children, className, testId }: { title: string; icon: LucideIcon; tone?: Tone; action?: { to: string; label: string }; children: ReactNode; className?: string; testId?: string }) {
  return (
    <Card className={className} data-testid={testId}>
      <div className="flex items-center gap-3 px-5 pb-2 pt-5">
        <IconChip icon={icon} tone={tone} className="h-8 w-8" />
        <h3 className="flex-1 font-semibold">{title}</h3>
        {action && (
          <Link to={action.to} className="inline-flex items-center text-xs font-medium text-primary hover:underline">
            {action.label}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <CardContent className="px-5 pb-5 pt-2">{children}</CardContent>
    </Card>
  );
}

/** A number with an icon chip: used in the horizontal strips at the top. */
export function Tile({ icon, tone = 'blue', label, value, hint, to }: { icon: LucideIcon; tone?: Tone; label: string; value: ReactNode; hint?: ReactNode; to?: string }) {
  const body = (
    <div className={cn('flex h-full items-center gap-3 rounded-xl p-3', to && 'transition-colors hover:bg-accent/60')}>
      <IconChip icon={icon} tone={tone} />
      <div className="min-w-0">
        <div className="text-2xl font-semibold leading-tight">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/** One line of a list card: icon, label, and a value pill on the right (highlighted when it needs attention). */
export function ListRow({ icon: Icon, label, value, attention, to }: { icon: LucideIcon; label: ReactNode; value: ReactNode; attention?: 'amber' | 'red'; to?: string }) {
  const inner = (
    <>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={cn(
          'min-w-[2rem] rounded-full px-2 py-0.5 text-center text-xs font-semibold',
          attention === 'red' ? 'bg-red-100 text-red-800' : attention === 'amber' ? 'bg-amber-100 text-amber-900' : 'bg-muted text-foreground',
        )}
      >
        {value}
      </span>
    </>
  );
  const cls = 'flex items-center gap-3 rounded-lg px-2 py-2 text-sm';
  return to ? (
    <Link to={to} className={cn(cls, 'hover:bg-accent/60')}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** A thin bar showing how a whole splits into parts, with a legend underneath (identity never by colour alone). */
export function SegBar({ parts, label }: { parts: { name: string; value: number; color: string; display?: ReactNode }[]; label: string }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.value}`).join(', ')}`}>
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => <span key={p.name} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.name}: ${p.value}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => (
          <span key={p.name} className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.name} <span className="font-semibold text-foreground">{p.display ?? p.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** A filled meter (e.g. checked in out of headcount); the track is a light step of the same hue. */
export function Meter({ value, max, color = '#2a78d6', track = '#dbe8f8' }: { value: number; max: number; color?: string; track?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: track }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** Categorical slots (validated set) for parts of a whole. */
export const SERIES = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a' };
/** Status colours: only for good / warning / critical, always with a label. */
export const STATUS = { good: '#16a34a', warning: '#d97706', critical: '#dc2626' };
