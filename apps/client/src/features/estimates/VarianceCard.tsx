import { useGet } from '@/api/hooks';
import { cn, fmtDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { inr } from '@/features/payroll/types';

type Flag = 'ok' | 'warn' | 'alert' | 'none';
interface V {
  hasEstimate: boolean;
  canSeeMoney?: boolean;
  estimate?: { version: number; totalHours: number; totalCost?: number; approvedAt?: string };
  actual?: { hours: number; cost?: number };
  hoursOverPct?: number | null;
  costOverPct?: number | null;
  flag?: Flag;
  progress?: number;
  forecastHours?: number | null;
  forecastOverPct?: number | null;
  thresholds?: { warnPct: number; alertPct: number };
  byRole?: { role: string; estHours: number; actHours: number; estCost?: number; actCost?: number; hoursOverPct: number | null }[];
  byModule?: { module: string; estHours: number; actHours: number; hoursOverPct: number | null }[];
  byPerson?: { employee: { _id: string; name: string }; role: string; rateAssumed: boolean; hours: number; cost?: number }[];
  burn?: { week: string; hours: number }[];
}

export const FLAG_TONE: Record<Flag, string> = { ok: 'text-green-700', warn: 'text-amber-600', alert: 'text-red-700', none: 'text-muted-foreground' };
export const FLAG_LABEL: Record<Flag, string> = { ok: 'Within estimate', warn: 'Running over', alert: 'Well over', none: '' };
export const over = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n}%`);
const h = (n: number) => `${Math.round(n * 10) / 10} h`;

/** Actual hours and cost against the approved estimate. Shows nothing for people who may not see it. */
export function VarianceCard({ projectId }: { projectId: string }) {
  const { data, isError } = useGet<V>(['estimates', 'variance', projectId], `/estimates/project/${projectId}/variance`);
  if (isError || !data) return null;
  if (!data.hasEstimate)
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">Estimated vs actual appears here once an estimate has been approved (Estimate tab).</CardContent>
      </Card>
    );
  const money = data.canSeeMoney;
  const e = data.estimate!;
  const a = data.actual!;
  const flag = data.flag ?? 'none';
  const peak = Math.max(e.totalHours, ...(data.burn ?? []).map((b) => b.hours), 1);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          Estimated vs actual <span className="ml-1 text-sm font-normal text-muted-foreground">estimate v{e.version}</span>
        </CardTitle>
        <Badge variant="outline" className={cn(FLAG_TONE[flag])}>
          {FLAG_LABEL[flag]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Hours" main={`${h(a.hours)} of ${h(e.totalHours)}`} sub={over(data.hoursOverPct)} tone={data.hoursOverPct} th={data.thresholds} />
          {money && <Figure label="Cost" main={`${inr(a.cost ?? 0)} of ${inr(e.totalCost ?? 0)}`} sub={over(data.costOverPct)} tone={data.costOverPct} th={data.thresholds} />}
          <Figure label="Work done" main={`${Math.round((data.progress ?? 0) * 100)}%`} sub="of estimated task hours" />
          <Figure
            label="Forecast"
            main={data.forecastHours != null ? h(data.forecastHours) : '—'}
            sub={data.forecastHours != null ? `${over(data.forecastOverPct)} vs estimate` : 'once 10% of the work is done'}
            tone={data.forecastOverPct}
            th={data.thresholds}
          />
        </div>

        {!!data.burn?.length && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Hours logged, running total by week (line is the estimate)</p>
            <div className="relative mt-3 flex h-24 items-end gap-1 border-b">
              <div className="absolute inset-x-0 border-t border-dashed border-primary" style={{ bottom: `${(e.totalHours / peak) * 100}%` }} />
              {data.burn.map((b) => (
                <div key={b.week} className={cn('max-w-10 flex-1 rounded-t', b.hours > e.totalHours ? 'bg-red-500' : 'bg-blue-500')} style={{ height: `${(b.hours / peak) * 100}%` }} title={`Week of ${fmtDate(b.week)}: ${h(b.hours)}`} />
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown title="By role" rows={(data.byRole ?? []).map((r) => ({ key: r.role, est: r.estHours, act: r.actHours, over: r.hoursOverPct }))} />
          <Breakdown title="By module" rows={(data.byModule ?? []).map((r) => ({ key: r.module, est: r.estHours, act: r.actHours, over: r.hoursOverPct }))} note="Tag tasks with a module to see actual hours here." />
        </div>

        <Table>
          <THead>
            <TR>
              <TH>Person</TH>
              <TH>Role</TH>
              <TH className="text-right">Hours</TH>
              {money && <TH className="text-right">Cost</TH>}
            </TR>
          </THead>
          <TBody>
            {(data.byPerson ?? []).map((p) => (
              <TR key={p.employee._id}>
                <TD>{p.employee.name}</TD>
                <TD>
                  {p.role}
                  {p.rateAssumed && <span className="ml-1 text-xs text-muted-foreground" title="Designation does not match a rate card role; costed at the estimate's average rate">(rate assumed)</span>}
                </TD>
                <TD className="text-right tabular-nums">{h(p.hours)}</TD>
                {money && <TD className="text-right tabular-nums">{inr(p.cost ?? 0)}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Figure({ label, main, sub, tone, th }: { label: string; main: string; sub?: string; tone?: number | null; th?: { warnPct: number; alertPct: number } }) {
  const cls = tone == null || !th ? '' : tone >= th.alertPct ? 'text-red-700' : tone >= th.warnPct ? 'text-amber-600' : 'text-green-700';
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{main}</p>
      <p className={cn('text-xs', cls || 'text-muted-foreground')}>{sub}</p>
    </div>
  );
}

function Breakdown({ title, rows, note }: { title: string; rows: { key: string; est: number; act: number; over: number | null }[]; note?: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <Table>
        <THead>
          <TR>
            <TH>{title.replace('By ', '')}</TH>
            <TH className="text-right">Estimated</TH>
            <TH className="text-right">Actual</TH>
            <TH className="text-right">Over</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.key}>
              <TD>{r.key}</TD>
              <TD className="text-right tabular-nums">{h(r.est)}</TD>
              <TD className="text-right tabular-nums">{h(r.act)}</TD>
              <TD className={cn('text-right tabular-nums', r.over != null && r.over > 0 && 'text-amber-600')}>{over(r.over)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {note && rows.every((r) => r.act === 0 || r.key === '(no module)') && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
