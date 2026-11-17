import { Link } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { cn, fmtDate } from '@/lib/utils';
import { Stat } from '@/components/common/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { inr } from '@/features/payroll/types';

interface Insights {
  me?: { balances: { code: string; name: string; available: number }[]; holidays: { date: string; name: string }[] };
  hr?: { pendingLeave: number; pendingRegularization: number; joiners: number; exits: number; payrollRun: { month: string; status: string } | null };
  payroll?: { month: string; status: string; employees: number; gross: number; net: number; employerContributions: number } | null;
  projects?: { scope: 'all' | 'mine'; open: number; milestones: { late: number; at_risk: number; on_track: number; upcoming: number }; overdueTasks: number; worst: { _id: string; code: string; name: string; late: number; atRisk: number }[] };
  estimates?: { counts: { ok: number; warn: number; alert: number }; over: { _id: string; code: string; name: string; flag: 'warn' | 'alert'; hoursOverPct: number | null; costOverPct: number | null }[] };
  enquiries?: { scope: 'all' | 'team' | 'mine'; stages: { stage: string; n: number }[]; open: number; won: number; lost: number; conversionRate: number | null; dueCount: number; due: { _id: string; name: string; company?: string; nextFollowUp: string; overdue: boolean; owner?: { name: string } }[] };
  ideas?: { trending: { _id: string; title: string; votes: number }[]; awaitingReview: number | null };
}

const pct = (n: number | null | undefined) => (n == null ? '' : `${n > 0 ? '+' : ''}${n}%`);

/** Role-based cards under the welcome row. Each one is present only if the server sent it for this person. */
export function InsightCards() {
  const { data: d } = useGet<Insights>(['dashboard', 'insights'], '/dashboard/insights');
  if (!d) return null;
  const maxStage = Math.max(1, ...(d.enquiries?.stages.map((s) => s.n) ?? [1]));

  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {d.projects && (
        <Card data-testid="card-projects">
          <CardHeader>
            <CardTitle className="text-base">{d.projects.scope === 'all' ? 'Project health' : 'My projects'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Open projects" value={d.projects.open} />
              <Stat label="Overdue tasks" value={d.projects.overdueTasks} tone={d.projects.overdueTasks ? 'bad' : undefined} />
              <Stat label="Late milestones" value={d.projects.milestones.late} tone={d.projects.milestones.late ? 'bad' : undefined} />
              <Stat label="At risk" value={d.projects.milestones.at_risk} tone={d.projects.milestones.at_risk ? 'warn' : undefined} />
            </div>
            {d.projects.worst.length > 0 && (
              <ul className="space-y-1 text-sm">
                {d.projects.worst.map((p) => (
                  <li key={p._id} className="flex justify-between gap-2">
                    <Link className="truncate text-primary hover:underline" to={`/projects/${p._id}?tab=timeline`}>
                      {p.code} {p.name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {p.late ? `${p.late} late` : ''}
                      {p.late && p.atRisk ? ', ' : ''}
                      {p.atRisk ? `${p.atRisk} at risk` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {d.estimates && (
        <Card data-testid="card-estimates">
          <CardHeader>
            <CardTitle className="text-base">Estimates vs actual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Within" value={d.estimates.counts.ok} tone="good" />
              <Stat label="Running over" value={d.estimates.counts.warn} tone={d.estimates.counts.warn ? 'warn' : undefined} />
              <Stat label="Well over" value={d.estimates.counts.alert} tone={d.estimates.counts.alert ? 'bad' : undefined} />
            </div>
            {d.estimates.over.map((p) => (
              <p key={p._id} className="flex justify-between gap-2 text-sm">
                <Link className="truncate text-primary hover:underline" to={`/projects/${p._id}?tab=overview`}>
                  {p.code} {p.name}
                </Link>
                <span className={cn('shrink-0 text-xs', p.flag === 'alert' ? 'text-red-700' : 'text-amber-600')}>
                  {pct(p.hoursOverPct)} h · {pct(p.costOverPct)} cost
                </span>
              </p>
            ))}
            <Link to="/estimates/report" className="block text-sm text-primary hover:underline">
              Full report →
            </Link>
          </CardContent>
        </Card>
      )}

      {d.enquiries && (
        <Card data-testid="card-enquiries">
          <CardHeader>
            <CardTitle className="text-base">{d.enquiries.scope === 'all' ? 'Enquiry pipeline' : d.enquiries.scope === 'team' ? "My team's enquiries" : 'My enquiries'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Open" value={d.enquiries.open} />
              <Stat label="Follow-ups due" value={d.enquiries.dueCount} tone={d.enquiries.dueCount ? 'warn' : undefined} />
              <Stat label="Won / closed" value={d.enquiries.conversionRate == null ? '—' : `${d.enquiries.conversionRate}%`} />
            </div>
            <ul className="space-y-1">
              {d.enquiries.stages.map((s) => (
                <li key={s.stage} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 truncate text-muted-foreground">{s.stage}</span>
                  <span className="h-2 rounded bg-primary" style={{ width: `${(s.n / maxStage) * 100}%`, minWidth: 4 }} />
                  <span className="tabular-nums">{s.n}</span>
                </li>
              ))}
            </ul>
            {d.enquiries.due.length > 0 && (
              <div className="border-t pt-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Follow up today</p>
                <ul className="space-y-1 text-sm">
                  {d.enquiries.due.map((e) => (
                    <li key={e._id} className="flex justify-between gap-2">
                      <Link className="truncate text-primary hover:underline" to={`/enquiries/${e._id}`}>
                        {e.name}
                        {e.company ? ` · ${e.company}` : ''}
                      </Link>
                      <span className={cn('shrink-0 text-xs', e.overdue ? 'text-red-700' : 'text-muted-foreground')}>{e.overdue ? `since ${fmtDate(e.nextFollowUp)}` : 'today'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link to="/enquiries" className="block text-sm text-primary hover:underline">
              Open enquiries →
            </Link>
          </CardContent>
        </Card>
      )}

      {d.payroll !== undefined && (
        <Card data-testid="card-payroll">
          <CardHeader>
            <CardTitle className="text-base">Payroll cost</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {d.payroll ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Latest approved month: {d.payroll.month} · {d.payroll.employees} people
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Gross" value={inr(d.payroll.gross)} />
                  <Stat label="Net pay" value={inr(d.payroll.net)} />
                </div>
                <p className="text-xs text-muted-foreground">Employer contributions {inr(d.payroll.employerContributions)}</p>
              </>
            ) : (
              <p className="text-muted-foreground">No payroll has been approved yet.</p>
            )}
            <Link to="/payroll/runs" className="block text-primary hover:underline">
              Payroll runs →
            </Link>
          </CardContent>
        </Card>
      )}

      {d.hr && (
        <Card data-testid="card-hr">
          <CardHeader>
            <CardTitle className="text-base">People and requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Leave waiting" value={d.hr.pendingLeave} tone={d.hr.pendingLeave ? 'warn' : undefined} />
              <Stat label="Corrections waiting" value={d.hr.pendingRegularization} tone={d.hr.pendingRegularization ? 'warn' : undefined} />
              <Stat label="Joined this month" value={d.hr.joiners} />
              <Stat label="Leaving this month" value={d.hr.exits} />
            </div>
            <p className="text-sm text-muted-foreground">{d.hr.payrollRun ? `Payroll ${d.hr.payrollRun.month}: ${d.hr.payrollRun.status.replace('_', ' ')}` : 'No payroll run started this month.'}</p>
            <Link to="/approvals" className="block text-sm text-primary hover:underline">
              Open approvals →
            </Link>
          </CardContent>
        </Card>
      )}

      {d.me && (
        <Card data-testid="card-me">
          <CardHeader>
            <CardTitle className="text-base">My leave and holidays</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.me.balances.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {d.me.balances.map((b) => (
                  <Stat key={b.code} label={b.code} value={b.available} />
                ))}
              </div>
            )}
            {d.me.holidays.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {d.me.holidays.map((h) => (
                  <li key={h.date} className="flex justify-between gap-2">
                    <span>{h.name}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(h.date)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming holidays on the calendar.</p>
            )}
            <Link to="/my/leave" className="block text-sm text-primary hover:underline">
              Apply for leave →
            </Link>
          </CardContent>
        </Card>
      )}

      {d.ideas && (
        <Card data-testid="card-ideas">
          <CardHeader>
            <CardTitle className="text-base">Innovation hub</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {d.ideas.awaitingReview != null && d.ideas.awaitingReview > 0 && <p className="font-medium text-amber-700">{d.ideas.awaitingReview} idea{d.ideas.awaitingReview === 1 ? '' : 's'} waiting for review</p>}
            {d.ideas.trending.length ? (
              <ul className="space-y-1">
                {d.ideas.trending.map((i) => (
                  <li key={i._id} className="flex justify-between gap-2">
                    <Link className="truncate text-primary hover:underline" to={`/ideas/${i._id}`}>
                      {i.title}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{i.votes} vote{i.votes === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No ideas yet. Be the first to share one.</p>
            )}
            <Link to="/ideas" className="block text-primary hover:underline">
              Open the hub →
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
