import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Stat } from '@/components/common/page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckInWidget } from '@/features/attendance/CheckInWidget';

interface Dashboard {
  myPending?: { leave: number; regularization: number };
  myMissedCheckouts?: { date: string }[];
  today?: { headcount: number; checkedIn: number; late: number; onLeave: number };
  approvals?: { leave: number; regularization: number };
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const { data } = useGet<Dashboard>(['dashboard'], '/dashboard');

  return (
    <>
      <PageHeader title={`Welcome, ${user?.employee?.name ?? user?.email}`} description={user?.employee?.designation} />
      <div className="grid gap-4 lg:grid-cols-3">
        {can(P.ATTENDANCE_SELF) && user?.employee && <CheckInWidget />}

        <div className="space-y-4 lg:col-span-2">
          {!!data?.myMissedCheckouts?.length && (
            <Card className="border-amber-300 bg-amber-50">
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

          {data?.today && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{can(P.ATTENDANCE_ALL) ? 'Office today' : 'My team today'}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Headcount" value={data.today.headcount} />
                <Stat label="Checked in" value={data.today.checkedIn} tone="good" />
                <Stat label="Late" value={data.today.late} tone="warn" />
                <Stat label="On leave" value={data.today.onLeave} />
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {data?.approvals && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Waiting for my approval</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <Stat label="Leave" value={data.approvals.leave} tone={data.approvals.leave ? 'warn' : undefined} />
                  <Stat label="Regularization" value={data.approvals.regularization} tone={data.approvals.regularization ? 'warn' : undefined} />
                  <Link to="/approvals" className="col-span-2 text-sm text-primary hover:underline">
                    Open approvals →
                  </Link>
                </CardContent>
              </Card>
            )}
            {data?.myPending && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">My pending requests</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <Stat label="Leave" value={data.myPending.leave} />
                  <Stat label="Regularization" value={data.myPending.regularization} />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
