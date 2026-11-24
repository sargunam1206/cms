import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  AlertOctagon,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Flag,
  FolderKanban,
  Gauge,
  IndianRupee,
  Lightbulb,
  Megaphone,
  Palmtree,
  Sparkles,
  ThumbsUp,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useGet } from '@/api/hooks';
import { cn, fmtDate } from '@/lib/utils';
import { inr } from '@/features/payroll/types';
import { DashCard, ListRow, SERIES, STATUS, SegBar } from './widgets';

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
const SECTION = 'mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

/** Role-based cards under the top band, each with its own shape. Each is present only if the server sent it for this person. */
export function InsightCards() {
  const { data: d } = useGet<Insights>(['dashboard', 'insights'], '/dashboard/insights');
  if (!d) return null;
  const maxStage = Math.max(1, ...(d.enquiries?.stages.map((s) => s.n) ?? [1]));

  return (
    <>
      {d.payroll !== undefined && (
        <DashCard title="Payroll cost" icon={IndianRupee} tone="green" action={{ to: '/payroll/runs', label: 'Payroll runs' }} testId="card-payroll">
          {d.payroll ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs text-muted-foreground">Net pay · {dayjs(`${d.payroll.month}-01`).format('MMMM YYYY')}</div>
                <div className="text-3xl font-semibold tracking-tight">{inr(d.payroll.net)}</div>
                <div className="text-xs text-muted-foreground">
                  {d.payroll.employees} {d.payroll.employees === 1 ? 'person' : 'people'} · gross {inr(d.payroll.gross)}
                </div>
              </div>
              <SegBar
                label="Payroll cost split"
                parts={[
                  { name: 'Net pay', value: d.payroll.net, color: SERIES.blue, display: inr(d.payroll.net) },
                  { name: 'Deductions', value: Math.max(0, d.payroll.gross - d.payroll.net), color: SERIES.orange, display: inr(Math.max(0, d.payroll.gross - d.payroll.net)) },
                  { name: 'Employer share', value: d.payroll.employerContributions, color: SERIES.aqua, display: inr(d.payroll.employerContributions) },
                ]}
              />
            </div>
          ) : (
            <Empty icon={IndianRupee} text="No payroll has been approved yet." />
          )}
        </DashCard>
      )}

      {d.projects && (
        <DashCard title={d.projects.scope === 'all' ? 'Project health' : 'My projects'} icon={FolderKanban} tone="blue" action={{ to: '/projects', label: 'Projects' }} testId="card-projects">
          <div className="mb-3 flex items-end gap-2">
            <span className="text-3xl font-semibold leading-none">{d.projects.open}</span>
            <span className="pb-0.5 text-sm text-muted-foreground">open project{d.projects.open === 1 ? '' : 's'}</span>
          </div>
          <div className="-mx-2 space-y-0.5">
            <ListRow icon={AlertOctagon} label="Overdue tasks" value={d.projects.overdueTasks} attention={d.projects.overdueTasks ? 'red' : undefined} />
            <ListRow icon={Flag} label="Late milestones" value={d.projects.milestones.late} attention={d.projects.milestones.late ? 'red' : undefined} />
            <ListRow icon={TriangleAlert} label="Milestones at risk" value={d.projects.milestones.at_risk} attention={d.projects.milestones.at_risk ? 'amber' : undefined} />
            <ListRow icon={CheckCircle2} label="Milestones on track" value={d.projects.milestones.on_track} />
          </div>
          {d.projects.worst.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className={SECTION}>Needs attention</p>
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
            </div>
          )}
        </DashCard>
      )}

      {d.hr && (
        <DashCard title="People" icon={Users} tone="violet" action={{ to: '/employees', label: 'Employees' }} testId="card-hr">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-50 p-3">
              <UserPlus className="h-4 w-4 text-emerald-700" />
              <div className="mt-1 text-2xl font-semibold">{d.hr.joiners}</div>
              <div className="text-xs text-muted-foreground">joined this month</div>
            </div>
            <div className="rounded-xl bg-slate-100 p-3">
              <UserMinus className="h-4 w-4 text-slate-600" />
              <div className="mt-1 text-2xl font-semibold">{d.hr.exits}</div>
              <div className="text-xs text-muted-foreground">leaving this month</div>
            </div>
          </div>
          <div className="-mx-2 mt-3 space-y-0.5">
            <ListRow icon={CalendarDays} label="Leave waiting" value={d.hr.pendingLeave} attention={d.hr.pendingLeave ? 'amber' : undefined} to="/approvals" />
            <ListRow icon={ClipboardCheck} label="Corrections waiting" value={d.hr.pendingRegularization} attention={d.hr.pendingRegularization ? 'amber' : undefined} to="/approvals" />
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 shrink-0" />
            {d.hr.payrollRun ? (
              <span>
                Payroll {dayjs(`${d.hr.payrollRun.month}-01`).format('MMM YYYY')}: <span className="font-medium capitalize text-foreground">{d.hr.payrollRun.status.replace('_', ' ')}</span>
              </span>
            ) : (
              'No payroll run started this month.'
            )}
          </div>
        </DashCard>
      )}

      {d.estimates && (
        <DashCard title="Estimates vs actual" icon={Gauge} tone="amber" action={{ to: '/estimates/report', label: 'Full report' }} testId="card-estimates">
          {d.estimates.counts.ok + d.estimates.counts.warn + d.estimates.counts.alert === 0 ? (
            <Empty icon={Gauge} text="No projects with an approved estimate yet." />
          ) : (
            <SegBar
              label="Projects against their estimate"
              parts={[
                { name: 'Within', value: d.estimates.counts.ok, color: STATUS.good },
                { name: 'Running over', value: d.estimates.counts.warn, color: STATUS.warning },
                { name: 'Well over', value: d.estimates.counts.alert, color: STATUS.critical },
              ]}
            />
          )}
          {d.estimates.over.length > 0 && (
            <ul className="mt-3 space-y-1 border-t pt-3 text-sm">
              {d.estimates.over.map((p) => (
                <li key={p._id} className="flex justify-between gap-2">
                  <Link className="truncate text-primary hover:underline" to={`/projects/${p._id}?tab=overview`}>
                    {p.code} {p.name}
                  </Link>
                  <span className={cn('shrink-0 text-xs font-medium', p.flag === 'alert' ? 'text-red-700' : 'text-amber-700')}>
                    {pct(p.hoursOverPct)} h · {pct(p.costOverPct)} cost
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DashCard>
      )}

      {d.enquiries && (
        <DashCard
          title={d.enquiries.scope === 'all' ? 'Enquiry pipeline' : d.enquiries.scope === 'team' ? "My team's enquiries" : 'My enquiries'}
          icon={Megaphone}
          tone="blue"
          action={{ to: '/enquiries', label: 'Enquiries' }}
          testId="card-enquiries"
        >
          <div className="mb-3 grid grid-cols-3 divide-x rounded-xl border text-center">
            <div className="py-2">
              <div className="text-xl font-semibold">{d.enquiries.open}</div>
              <div className="text-[11px] text-muted-foreground">Open</div>
            </div>
            <div className="py-2">
              <div className={cn('text-xl font-semibold', d.enquiries.dueCount > 0 && 'text-amber-700')}>{d.enquiries.dueCount}</div>
              <div className="text-[11px] text-muted-foreground">Follow-ups due</div>
            </div>
            <div className="py-2">
              <div className="text-xl font-semibold">{d.enquiries.conversionRate == null ? '—' : `${d.enquiries.conversionRate}%`}</div>
              <div className="text-[11px] text-muted-foreground">Won rate</div>
            </div>
          </div>
          {d.enquiries.stages.length > 0 && (
            <ul className="space-y-1.5">
              {d.enquiries.stages.map((s) => (
                <li key={s.stage} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{s.stage}</span>
                  <span className="h-2.5 rounded-r" style={{ width: `${(s.n / maxStage) * 100}%`, minWidth: s.n ? 4 : 0, background: SERIES.blue }} />
                  <span className="text-right font-medium tabular-nums">{s.n}</span>
                </li>
              ))}
            </ul>
          )}
          {d.enquiries.due.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className={SECTION}>Follow up today</p>
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
        </DashCard>
      )}

      {d.me && (
        <DashCard title="My leave and holidays" icon={Palmtree} tone="green" action={{ to: '/my/leave', label: 'Apply' }} testId="card-me">
          {d.me.balances.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.me.balances.map((b) => (
                <div key={b.code} className="min-w-[4.5rem] flex-1 rounded-xl border bg-gradient-to-b from-emerald-50 to-card px-3 py-2" title={b.name}>
                  <div className="text-xl font-semibold">{b.available}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{b.code} left</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            {d.me.holidays.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {d.me.holidays.map((h) => (
                  <li key={h.date} className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border bg-card leading-none">
                      <span className="text-[9px] font-semibold uppercase text-red-600">{dayjs(h.date).format('MMM')}</span>
                      <span className="text-sm font-semibold">{dayjs(h.date).format('D')}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{h.name}</span>
                      <span className="text-xs text-muted-foreground">{dayjs(h.date).format('dddd')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={CalendarDays} text="No upcoming holidays on the calendar." />
            )}
          </div>
        </DashCard>
      )}

      {d.ideas && (
        <DashCard title="Innovation hub" icon={Lightbulb} tone="amber" action={{ to: '/ideas', label: 'Open the hub' }} testId="card-ideas">
          {d.ideas.awaitingReview != null && d.ideas.awaitingReview > 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              {d.ideas.awaitingReview} idea{d.ideas.awaitingReview === 1 ? '' : 's'} waiting for review
            </p>
          )}
          {d.ideas.trending.length ? (
            <ul className="space-y-1.5 text-sm">
              {d.ideas.trending.map((i) => (
                <li key={i._id} className="flex items-center gap-2">
                  <span className="inline-flex min-w-[2.5rem] items-center justify-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold">
                    <ThumbsUp className="h-3 w-3" /> {i.votes}
                  </span>
                  <Link className="truncate text-primary hover:underline" to={`/ideas/${i._id}`}>
                    {i.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Sparkles} text="No ideas yet. Be the first to share one." />
          )}
        </DashCard>
      )}
    </>
  );
}

function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      <Icon className="h-5 w-5 shrink-0" /> {text}
    </div>
  );
}
