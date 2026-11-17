import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Plus } from 'lucide-react';
import { api, apiError } from '@/api/client';
import { useGet, useSend } from '@/api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form-controls';

export interface Day {
  date: string;
  type: string;
  availableMinutes: number | null;
  reason?: string;
  logged: number;
  canLog: boolean;
  remaining: number;
}
export interface Row {
  task: { _id: string; ref: string; title: string; status: string; project: { _id: string; code: string; name: string; status: string } };
  minutes: Record<string, number>;
  total: number;
}
export interface Week {
  employee: { _id: string; name: string; code: string };
  weekStart: string;
  days: Day[];
  rows: Row[];
  total: number;
  sheet: { status: 'open' | 'submitted' | 'approved' | 'rejected'; comment: string | null };
  requireApproval: boolean;
  toleranceMinutes: number;
  locked: boolean;
  lockReason: string | null;
}

/** 90 -> "1:30". Zero shows as an empty string so the grid stays readable. */
export const hm = (m: number) => (m ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '');
export const hmFull = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

/**
 * Accepts "1:30", "130" (clock digits: 200 is 2:00, 1030 is 10:30), "1.5" or "8" (hours), "90m" or "2h".
 * Blank means zero. Returns null when it cannot be read.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return 0;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  // three or four plain digits are typed clock-style: the last two are minutes (200 = 2:00, 1030 = 10:30)
  m = /^(\d{1,2})(\d{2})$/.exec(t);
  if (m) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
  m = /^(\d+)\s*m(in)?$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*h?$/.exec(t);
  if (m) return Number(m[1]) <= 24 ? Math.round(Number(m[1]) * 60) : null; // more than a day is a typo, not a time
  return null;
}

/**
 * Shapes what is typed into a cell while typing: plain digits get their colon (200 shows as 2:00, 1030 as 10:30).
 * Anything else (1:30, 1.5, 90m, 2h) is left exactly as typed.
 */
export function maskTime(raw: string) {
  // "1:03" plus one more digit: take the colon out and shape the digits again (1:030 becomes 10:30)
  if (/^\d{1,2}:\d{3,}$/.test(raw)) raw = raw.replace(':', '');
  if (!/^\d+$/.test(raw)) return raw;
  const d = raw.slice(0, 4);
  return d.length >= 3 ? `${d.slice(0, -2)}:${d.slice(-2)}` : d;
}

export const STATUS_VARIANT = { open: 'secondary', submitted: 'warning', approved: 'success', rejected: 'destructive' } as const;

/** One person's week. Editable only for your own, unlocked week; managers and HR see it read-only. */
export function TimesheetGrid({ employeeId, weekStart, readOnly }: { employeeId?: string; weekStart: string; readOnly?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useGet<Week>(['timesheets', 'week', employeeId ?? 'me'], '/timesheets/week', { start: weekStart, employee: employeeId });
  const options = useGet<{ _id: string; ref: string; title: string; project: { name: string } }[]>(['timesheets', 'tasks'], '/timesheets/tasks', undefined, !readOnly);
  const [extra, setExtra] = useState<Row['task'][]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    setExtra([]);
    setDraft({});
  }, [weekStart, employeeId]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['timesheets'] });
  const submit = useSend('post', '/timesheets/submit', { invalidate: [['timesheets']], success: 'Week submitted for approval', body: () => ({ weekStart }) });

  if (isLoading || !data) return <Spinner />;
  const editable = !readOnly && !data.locked;
  const rows: Row[] = [...data.rows, ...extra.filter((t) => !data.rows.some((r) => r.task._id === t._id)).map((task) => ({ task, minutes: {}, total: 0 }))];
  const key = (task: string, date: string) => `${task}|${date}`;

  async function commit(task: string, date: string, current: number) {
    const k = key(task, date);
    const text = draft[k];
    if (text === undefined) return;
    const minutes = parseDuration(text);
    setDraft(({ [k]: _drop, ...rest }) => rest);
    if (minutes === null) return toast.error(`"${text}" is not a time. Use h:mm, for example 1:30 or 130`);
    if (minutes === current) return;
    try {
      await api.put('/timesheets/log', { task, date, minutes });
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  const status = data.sheet.status;
  return (
    <div className="space-y-3">
      {data.requireApproval && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={STATUS_VARIANT[status]} className="capitalize">
            {status === 'open' ? 'Not submitted' : status}
          </Badge>
          {status === 'rejected' && data.sheet.comment && <span className="text-red-700">Sent back: {data.sheet.comment}</span>}
          {!readOnly && (status === 'open' || status === 'rejected') && (
            <Button size="sm" disabled={!data.total || submit.isPending} onClick={() => submit.mutate(undefined)}>
              Submit week
            </Button>
          )}
        </div>
      )}
      {!data.requireApproval && !data.locked && <p className="text-xs text-muted-foreground">Timesheet approval is off: time you log counts straight away, so there is nothing to submit. HR can switch approval on in Settings → Timesheets.</p>}
      {data.locked && !data.requireApproval && data.lockReason && <p className="text-sm text-amber-700">{data.lockReason}.</p>}
      {data.locked && data.requireApproval && status !== 'open' && !readOnly && <p className="text-sm text-muted-foreground">{data.lockReason}.</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">Task</th>
              {data.days.map((d) => (
                <th key={d.date} className={cn('w-24 px-1 py-2 text-center font-medium', !d.canLog && 'text-muted-foreground')} title={d.reason}>
                  <div>{dayjs(d.date).format('ddd D')}</div>
                  <div className="text-[11px] font-normal text-muted-foreground">{d.availableMinutes != null ? `${hmFull(d.availableMinutes)} at work` : (d.reason ?? '')}</div>
                </th>
              ))}
              <th className="w-20 px-3 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.task._id} className="border-b">
                <td className="px-3 py-1.5">
                  <div className="font-medium">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{r.task.ref}</span>
                    {r.task.title}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.task.project.name}</div>
                </td>
                {data.days.map((d) => {
                  const k = key(r.task._id, d.date);
                  const current = r.minutes[d.date] ?? 0;
                  const can = editable && d.canLog;
                  return (
                    <td key={d.date} className={cn('px-1 py-1 text-center', !d.canLog && 'bg-muted/30')}>
                      <input
                        aria-label={`${r.task.ref} on ${dayjs(d.date).format('ddd D MMM')}`}
                        className="h-8 w-20 rounded-md border border-transparent bg-transparent text-center tabular-nums hover:border-input focus:border-ring focus:outline-none disabled:cursor-default disabled:opacity-100"
                        value={draft[k] ?? hm(current)}
                        disabled={!can}
                        placeholder={can ? '0:00' : ''}
                        inputMode="text"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setDraft({ ...draft, [k]: maskTime(e.target.value) })}
                        onBlur={() => commit(r.task._id, d.date, current)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">{hm(r.total) || '0:00'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  No tasks yet. {readOnly ? 'Nothing was logged this week.' : 'Add a task below to start logging time.'}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-muted/30 font-medium">
              <td className="px-3 py-2">Logged</td>
              {data.days.map((d) => (
                <td key={d.date} className={cn('px-1 py-2 text-center tabular-nums', d.availableMinutes != null && d.logged > d.availableMinutes + data.toleranceMinutes && 'text-red-700')}>
                  {hmFull(d.logged)}
                </td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums">{hmFull(data.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <Select
            className="w-80"
            value=""
            aria-label="Add a task to the grid"
            disabled={!options.data?.some((o) => !rows.some((r) => r.task._id === o._id))}
            onChange={(e) => {
              const o = options.data?.find((t) => t._id === e.target.value);
              if (o) setExtra([...extra, { _id: o._id, ref: o.ref, title: o.title, status: 'todo', project: { _id: '', code: '', name: o.project.name, status: 'active' } }]);
            }}
          >
            <option value="">{options.data?.some((o) => !rows.some((r) => r.task._id === o._id)) ? 'Add a task…' : 'No other open tasks in your projects'}</option>
            {options.data
              ?.filter((o) => !rows.some((r) => r.task._id === o._id))
              .map((o) => (
                <option key={o._id} value={o._id}>
                  {o.ref} · {o.title}
                </option>
              ))}
          </Select>
          <span className="text-xs text-muted-foreground">Type time as h:mm (1:30 or 130), hours (1.5) or minutes (90m). Days with no attendance, week-offs, holidays and leave are greyed out.</span>
        </div>
      )}
    </div>
  );
}
