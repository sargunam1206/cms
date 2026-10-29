import { useState } from 'react';
import dayjs from 'dayjs';
import { CheckCheck } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet } from '@/api/hooks';
import type { EmployeeMonth } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDate, thisMonth } from '@/lib/utils';
import { MonthPicker, PageHeader, Spinner } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TBody, TD, TR, Table } from '@/components/ui/table';
import { BulkOverrideDialog } from './BulkOverrideDialog';
import { LateReliefDialog, type LateReliefTarget } from './LateReliefDialog';
import { MonthCalendar, SummaryStats } from './MonthView';
import { OverrideDialog, type OverrideTarget } from './OverrideDialog';

export function EmployeeAttendancePage() {
  const { can, user } = useAuth();
  const [override, setOverride] = useState<OverrideTarget | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? thisMonth();
  const today = dayjs().format('YYYY-MM-DD');
  const monthEnd = dayjs(`${month}-01`).endOf('month').format('YYYY-MM-DD');
  const [relief, setRelief] = useState<LateReliefTarget | null>(null);
  const { data, isLoading } = useGet<EmployeeMonth>(['attendance', 'employee', id], `/attendance/employee/${id}`, { month });
  const lateDays = data?.days.filter((d) => d.isLate) ?? [];
  const canRelief = !!data && can(P.ATTENDANCE_OVERRIDE) && !data.locked && data.employee._id !== user?.employee?._id;

  return (
    <>
      <PageHeader
        title={data ? `${data.employee.name} (${data.employee.code})` : 'Attendance'}
        actions={
          <>
            <MonthPicker value={month} onChange={(m) => setParams({ month: m })} />
            {data && can(P.ATTENDANCE_OVERRIDE) && !data.locked && data.employee._id !== user?.employee?._id && (
              <Button onClick={() => setBulkOpen(true)}>
                <CheckCheck /> Mark multiple days
              </Button>
            )}
          </>
        }
      />
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <SummaryStats s={data.summary} />
          <Card>
            <CardContent className="pt-5">
              <MonthCalendar
                days={data.days}
                onPick={(d) => {
                  const ok = can(P.ATTENDANCE_OVERRIDE) && !data.locked && d.type === 'working' && d.date <= dayjs().format('YYYY-MM-DD') && data.employee._id !== user?.employee?._id;
                  if (ok) setOverride({ employee: data.employee, date: d.date });
                }}
              />
              {can(P.ATTENDANCE_OVERRIDE) && !data.locked && <p className="mt-3 text-xs text-muted-foreground">Click a past working day to mark attendance directly.</p>}
            </CardContent>
          </Card>

          {canRelief && lateDays.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Late marks this month</CardTitle>
                {lateDays.some((d) => !d.lateExcused) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRelief({ employee: data.employee, dates: lateDays.filter((d) => !d.lateExcused).map((d) => d.date), excused: true })}
                  >
                    Excuse all ({lateDays.filter((d) => !d.lateExcused).length})
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <Table>
                  <TBody>
                    {lateDays.map((d) => (
                      <TR key={d.date}>
                        <TD>{fmtDate(d.date)}</TD>
                        <TD>{d.record?.lateMinutes ?? 0} min late</TD>
                        <TD>
                          {d.lateExcused ? (
                            <Badge variant="secondary" title={d.record?.lateExcused?.reason}>
                              Excused{d.record?.lateExcused?.reason ? `: ${d.record.lateExcused.reason}` : ''}
                            </Badge>
                          ) : (
                            <Badge variant="warning">Counts towards LOP</Badge>
                          )}
                        </TD>
                        <TD className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setRelief({ employee: data.employee, dates: [d.date], excused: !d.lateExcused })}>
                            {d.lateExcused ? 'Restore' : 'Excuse'}
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      <LateReliefDialog target={relief} onClose={() => setRelief(null)} />
      <OverrideDialog target={override} onClose={() => setOverride(null)} />
      {data && (
        <BulkOverrideDialog
          open={bulkOpen}
          employees={[data.employee]}
          defaultDate={today < `${month}-01` ? `${month}-01` : today > monthEnd ? monthEnd : today}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </>
  );
}
