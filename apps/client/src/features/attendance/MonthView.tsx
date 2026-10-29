import dayjs from 'dayjs';
import type { AttendanceSummary, MonthDay } from '@/api/types';
import { cn, fmtMinutes, fmtTime } from '@/lib/utils';
import { Stat } from '@/components/common/page';

/** Short code + colour for one day, shared by the calendar and the register grid. */
export function dayCell(d: MonthDay): { code: string; cls: string; title: string } {
  if (d.type === 'inactive') return { code: '', cls: 'bg-muted/30', title: 'Not employed' };
  if (d.type === 'holiday') return { code: 'H', cls: 'bg-violet-100 text-violet-800', title: 'Holiday' };
  if (d.type === 'weekoff') return { code: 'W', cls: 'bg-slate-100 text-slate-500', title: 'Week off' };
  if (d.leave?.fraction === 1) return { code: d.leave.code ?? 'L', cls: d.leave.paid ? 'bg-sky-100 text-sky-800' : 'bg-orange-100 text-orange-800', title: 'Leave' };
  if (d.open) return { code: 'IN', cls: 'bg-emerald-50 text-emerald-700', title: 'Checked in' };
  if (d.record?.missedCheckout) return { code: 'MC', cls: 'bg-red-100 text-red-800', title: 'Missed check-out' };
  if (d.leave?.fraction === 0.5) return { code: `½${d.leave.code ?? 'L'}`, cls: 'bg-sky-50 text-sky-800', title: 'Half-day leave' };
  if (d.status === 'present') return { code: 'P', cls: cn('bg-emerald-100 text-emerald-800', d.isLate && (d.lateExcused ? 'ring-1 ring-inset ring-slate-300' : 'ring-1 ring-inset ring-amber-400')), title: d.isLate ? (d.lateExcused ? 'Present (late, excused)' : 'Present (late)') : 'Present' };
  if (d.status === 'half') return { code: '½', cls: 'bg-amber-100 text-amber-800', title: 'Half day' };
  if (d.date > dayjs().format('YYYY-MM-DD') || (d.date === dayjs().format('YYYY-MM-DD') && !d.status)) return { code: '', cls: '', title: '' };
  return { code: 'A', cls: 'bg-red-100 text-red-800', title: 'Absent' };
}

export function SummaryStats({ s }: { s: AttendanceSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      <Stat label="Working days" value={s.workingDays} />
      <Stat label="Present" value={s.presentDays} tone="good" />
      <Stat label="Paid leave" value={s.paidLeaveDays} />
      <Stat label="Absent" value={s.absentDays} tone={s.absentDays ? 'bad' : undefined} />
      <Stat
        label={s.lateExcusedCount ? 'Late (excused)' : 'Late marks'}
        value={s.lateExcusedCount ? `${s.lateCount} (${s.lateExcusedCount})` : s.lateCount}
        tone={s.lateCount - s.lateExcusedCount ? 'warn' : undefined}
      />
      <Stat label="Late penalty" value={s.latePenaltyDays} tone={s.latePenaltyDays ? 'bad' : undefined} />
      <Stat label="LOP days" value={s.lopDays} tone={s.lopDays ? 'bad' : undefined} />
      <Stat label="Paid days" value={`${s.paidDays} / ${s.totalDays}`} />
    </div>
  );
}

export function MonthCalendar({ days, onPick }: { days: MonthDay[]; onPick?: (d: MonthDay) => void }) {
  if (!days.length) return null;
  const lead = dayjs(days[0].date).day(); // 0 = Sunday
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`pad${i}`} />
        ))}
        {days.map((d) => {
          const c = dayCell(d);
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onPick?.(d)}
              title={c.title}
              className={cn('flex min-h-[72px] flex-col rounded-md border bg-background p-1.5 text-left text-xs transition hover:border-primary', c.cls)}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{dayjs(d.date).date()}</span>
                <span className="font-semibold">{c.code}</span>
              </div>
              {d.record?.checkIn && (
                <div className="mt-auto leading-tight opacity-80">
                  {fmtTime(d.record.checkIn)}
                  {d.record.checkOut && <> – {fmtTime(d.record.checkOut)}</>}
                  {d.record.workedMinutes > 0 && <div>{fmtMinutes(d.record.workedMinutes)}</div>}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>P present</span>
        <span>½ half day</span>
        <span>A absent</span>
        <span>MC missed check-out</span>
        <span>W week off</span>
        <span>H holiday</span>
        <span>CL/SL/EL leave</span>
        <span className="rounded px-1 ring-1 ring-amber-400">late</span>
      </div>
    </div>
  );
}
