import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { AlertTriangle, CalendarDays, ClipboardCheck, Clock3, FileText, GraduationCap, Inbox, Palmtree, Plane, Send, Timer, UserCheck, Users } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/common/page';
import { Card, CardContent } from '@/components/ui/card';
import { CheckInWidget } from '@/features/attendance/CheckInWidget';
import { InsightCards } from '@/features/dashboard/InsightCards';
import { MyWorkCard } from '@/features/dashboard/MyWorkCard';
import { MyMeetingsCard } from '@/features/meetings/MyMeetingsCard';
import { DashCard, IconChip, ListRow, Meter, SERIES, Tile } from './widgets';

interface Dashboard {
  myPending?: { leave: number; regularization: number };
  myMissedCheckouts?: { date: string }[];
  today?: { headcount: number; checkedIn: number; late: number; onLeave: number };
  approvals?: { leave: number; regularization: number };
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const { data } = useGet<Dashboard>(['dashboard'], '/dashboard');
  const showToday = can(P.ATTENDANCE_SELF) && !!user?.employee;
  const showWork = can(P.TASKS_SELF) && !!user?.employee;
  const t = data?.today;
  const requests = data?.approvals || data?.myPending;
  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader title={`${greeting}, ${user?.employee?.name ?? user?.email}`} description={[user?.employee?.designation, dayjs().format('dddd, D MMMM YYYY')].filter(Boolean).join(' · ')} />

      {!!data?.myMissedCheckouts?.length && (
        <Card className="mb-4 border-amber-300 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
            <div>
              Missed check-out on {data.myMissedCheckouts.map((d) => fmtDate(d.date)).join(', ')}. These count as absent until you{' '}
              <Link to="/my/attendance" className="font-medium underline">
                raise a regularization
              </Link>
              .
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top band: the clock on the left, today's numbers as strips on the right (same height) */}
      {(showToday || showWork || t) && (
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          {showToday && <CheckInWidget />}
          <div className={showToday ? 'flex flex-col gap-4 lg:col-span-2' : 'flex flex-col gap-4 lg:col-span-3'}>
            {t && (
              <Card className="flex-1">
                <div className="flex items-center justify-between px-5 pt-4">
                  <h3 className="text-sm font-semibold">{can(P.ATTENDANCE_ALL) ? 'Office today' : 'My team today'}</h3>
                  <span className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{t.checkedIn}</span> of {t.headcount} checked in
                  </span>
                </div>
                <div className="px-5 pt-2">
                  <Meter value={t.checkedIn} max={t.headcount} color={SERIES.aqua} track="#d5f1e6" />
                </div>
                <CardContent className="grid grid-cols-2 gap-1 p-3 sm:grid-cols-4">
                  <Tile icon={Users} tone="blue" label="Headcount" value={t.headcount} to={can(P.ATTENDANCE_TEAM, P.ATTENDANCE_ALL) ? '/attendance/register' : undefined} />
                  <Tile icon={UserCheck} tone="green" label="Checked in" value={t.checkedIn} />
                  <Tile icon={Clock3} tone={t.late ? 'amber' : 'slate'} label="Late" value={t.late} />
                  <Tile icon={Plane} tone="violet" label="On leave" value={t.onLeave} />
                </CardContent>
              </Card>
            )}
            {showWork && <MyWorkCard />}
            {/* with a single strip, quick actions fill the rest of the band instead of leaving it empty */}
            {showToday && !(t && showWork) && <QuickActions />}
          </div>
        </div>
      )}

      {/* Everything else: cards of different shapes, stacked tightly in columns so no gaps open up */}
      <div className="gap-4 md:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {requests && (
          <DashCard title="Requests" icon={Inbox} tone="amber" action={data?.approvals ? { to: '/approvals', label: 'Approvals' } : { to: '/my/leave', label: 'My leave' }}>
            <div className="-mx-2 space-y-0.5">
              {data?.approvals && (
                <>
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Waiting for me</p>
                  <ListRow icon={CalendarDays} label="Leave requests" value={data.approvals.leave} attention={data.approvals.leave ? 'amber' : undefined} to="/approvals" />
                  <ListRow icon={ClipboardCheck} label="Attendance corrections" value={data.approvals.regularization} attention={data.approvals.regularization ? 'amber' : undefined} to="/approvals" />
                </>
              )}
              {data?.myPending && (
                <>
                  <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sent by me</p>
                  <ListRow icon={Send} label="My leave requests" value={data.myPending.leave} to="/my/leave" />
                  <ListRow icon={Send} label="My corrections" value={data.myPending.regularization} to="/my/attendance" />
                </>
              )}
            </div>
          </DashCard>
        )}

        {can(P.MEETINGS_SELF) && user?.employee && <MyMeetingsCard />}

        <InsightCards />
      </div>
    </>
  );
}

/** Shortcuts to the everyday actions, shown in the top band when there is room. */
function QuickActions() {
  const { user, can } = useAuth();
  const intern = user?.employee?.type === 'intern';
  const items = [
    can(P.LEAVE_SELF) && { to: '/my/leave', label: 'Apply for leave', icon: Palmtree, tone: 'green' as const },
    can(P.TASKS_SELF) && { to: '/my/timesheet', label: 'Log my time', icon: Timer, tone: 'violet' as const },
    can(P.ATTENDANCE_SELF) && { to: '/my/attendance', label: 'Fix attendance', icon: ClipboardCheck, tone: 'amber' as const },
    can(P.MEETINGS_SELF) && { to: '/meetings', label: 'Schedule a meeting', icon: CalendarDays, tone: 'blue' as const },
    !intern && { to: '/my/payslips', label: 'My payslips', icon: FileText, tone: 'slate' as const },
    intern && { to: '/intern-work', label: 'My intern work', icon: GraduationCap, tone: 'slate' as const },
  ].filter(Boolean) as { to: string; label: string; icon: typeof Palmtree; tone: 'green' | 'violet' | 'amber' | 'blue' | 'slate' }[];
  return (
    <Card className="flex-1">
      <div className="px-5 pt-4">
        <h3 className="text-sm font-semibold">Quick actions</h3>
      </div>
      <CardContent className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 xl:grid-cols-5">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="flex flex-col items-start gap-2 rounded-xl border p-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent/50">
            <IconChip icon={i.icon} tone={i.tone} />
            {i.label}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
