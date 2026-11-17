import dayjs from 'dayjs';
import { cn } from '@/lib/utils';

export type MState = 'done' | 'late' | 'at_risk' | 'on_track' | 'upcoming';
export const STATE_LABEL: Record<MState, string> = { done: 'Done', late: 'Late', at_risk: 'At risk', on_track: 'On track', upcoming: 'Upcoming' };
export const STATE_COLOR: Record<MState, string> = {
  done: 'bg-green-600',
  late: 'bg-red-600',
  at_risk: 'bg-amber-500',
  on_track: 'bg-blue-600',
  upcoming: 'bg-slate-400',
};

export interface Bar {
  id: string;
  start: string;
  end: string;
  state: MState;
  /** 0..1 share of the bar to fill darker */
  progress?: number;
  baseStart?: string | null;
  baseEnd?: string | null;
  title: string;
  onClick?: () => void;
}
export interface Mark {
  id: string;
  date: string;
  title: string;
  done?: boolean;
}
export interface Row {
  id: string;
  label: string;
  sub?: string;
  bars: Bar[];
  marks?: Mark[];
  indent?: boolean;
  onLabelClick?: () => void;
}

const d = (a: string, b: string) => dayjs(b).diff(dayjs(a), 'day');

/** A Gantt-style chart in plain HTML: a row per item, bars placed by date, a line for today, and the baseline underneath. */
export function Gantt({ rows, today }: { rows: Row[]; today: string }) {
  const dates = [today, ...rows.flatMap((r) => [...r.bars.flatMap((b) => [b.start, b.end, b.baseStart, b.baseEnd]), ...(r.marks ?? []).map((m) => m.date)])].filter(Boolean) as string[];
  const min = dayjs(dates.reduce((a, b) => (a < b ? a : b))).startOf('month');
  const max = dayjs(dates.reduce((a, b) => (a > b ? a : b))).endOf('month');
  const start = min.format('YYYY-MM-DD');
  const span = Math.max(1, d(start, max.format('YYYY-MM-DD')) + 1);
  const pos = (date: string) => (d(start, date) / span) * 100;
  const width = (a: string, b: string) => Math.max(((d(a, b) + 1) / span) * 100, 0.8);
  const months: { label: string; left: number; width: number }[] = [];
  for (let m = min; m.isBefore(max); m = m.add(1, 'month')) months.push({ label: m.format('MMM YYYY'), left: pos(m.format('YYYY-MM-DD')), width: (m.daysInMonth() / span) * 100 });
  const minW = Math.max(720, Math.round(span * 6));

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <div style={{ minWidth: 220 + minW }}>
        <div className="flex border-b bg-muted/40 text-xs text-muted-foreground">
          <div className="sticky left-0 z-10 w-[220px] shrink-0 border-r bg-muted px-3 py-2 font-medium">Milestone</div>
          <div className="relative h-8 flex-1">
            {months.map((m) => (
              <div key={m.label} className="absolute top-0 h-full border-l px-1 pt-2" style={{ left: `${m.left}%`, width: `${m.width}%` }}>
                {m.label}
              </div>
            ))}
          </div>
        </div>
        {rows.map((r) => (
          <div key={r.id} className="flex border-b last:border-0">
            <div className={cn('sticky left-0 z-10 w-[220px] shrink-0 border-r bg-card px-3 py-2 text-sm', r.indent && 'pl-7 text-xs text-muted-foreground')}>
              {r.onLabelClick ? (
                <button type="button" className="text-left font-medium hover:underline" onClick={r.onLabelClick}>
                  {r.label}
                </button>
              ) : (
                <span className="font-medium">{r.label}</span>
              )}
              {r.sub && <div className="text-xs text-muted-foreground">{r.sub}</div>}
            </div>
            <div className="relative h-12 flex-1">
              {months.map((m) => (
                <div key={m.label} className="absolute top-0 h-full border-l border-dashed border-border/60" style={{ left: `${m.left}%` }} />
              ))}
              <div className="absolute top-0 z-[5] h-full w-px bg-primary" style={{ left: `${pos(today)}%` }} title={`Today, ${dayjs(today).format('DD MMM')}`} />
              {r.bars.map((b) => (
                <div key={b.id}>
                  {b.baseStart && b.baseEnd && (
                    <div className="absolute top-[34px] h-1.5 rounded bg-slate-300" style={{ left: `${pos(b.baseStart)}%`, width: `${width(b.baseStart, b.baseEnd)}%` }} title={`Baseline ${b.baseStart} to ${b.baseEnd}`} />
                  )}
                  <button
                    type="button"
                    title={b.title}
                    aria-label={b.title}
                    onClick={b.onClick}
                    className={cn('absolute top-2 h-6 overflow-hidden rounded text-left', b.state === 'upcoming' ? 'opacity-70' : '', STATE_COLOR[b.state], b.onClick ? 'cursor-pointer' : 'cursor-default')}
                    style={{ left: `${pos(b.start)}%`, width: `${width(b.start, b.end)}%` }}
                  >
                    {b.progress != null && <span className="absolute inset-y-0 left-0 bg-black/25" style={{ width: `${Math.round(b.progress * 100)}%` }} />}
                  </button>
                </div>
              ))}
              {r.marks?.map((m) => (
                <div
                  key={m.id}
                  title={m.title}
                  className={cn('absolute top-4 h-3 w-3 -translate-x-1/2 rotate-45 border border-background', m.done ? 'bg-green-600' : m.date < today ? 'bg-red-600' : 'bg-slate-600')}
                  style={{ left: `${pos(m.date) + (0.5 / span) * 100}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {(Object.keys(STATE_LABEL) as MState[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <span className={cn('inline-block h-2.5 w-4 rounded', STATE_COLOR[s])} /> {STATE_LABEL[s]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-1.5 w-4 rounded bg-slate-300" /> Baseline
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block h-3 w-px bg-primary" /> Today
      </span>
    </div>
  );
}
