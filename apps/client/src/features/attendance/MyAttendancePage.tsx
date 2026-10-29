import { useState } from 'react';
import dayjs from 'dayjs';
import { Lock, Plus } from 'lucide-react';
import { useGet, useSend } from '@/api/hooks';
import type { EmployeeMonth, Regularization } from '@/api/types';
import { fmtDate, thisMonth } from '@/lib/utils';
import { MonthPicker, PageHeader, Spinner } from '@/components/common/page';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { MonthCalendar, SummaryStats } from './MonthView';
import { RegularizationDialog, type RegularizationTarget } from './RegularizationDialog';

export function MyAttendancePage() {
  const [month, setMonth] = useState(thisMonth());
  const [reg, setReg] = useState<RegularizationTarget | null>(null);
  const { data, isLoading } = useGet<EmployeeMonth>(['attendance', 'me'], '/attendance/me', { month });
  const regs = useGet<Regularization[]>(['regularizations', 'mine'], '/regularizations/mine');
  const cancel = useSend<string>('post', (id) => `/regularizations/${id}/cancel`, { invalidate: [['regularizations']], success: 'Cancelled', body: () => ({}) });
  const today = dayjs().format('YYYY-MM-DD');

  return (
    <>
      <PageHeader
        title="My Attendance"
        description="Click a past day to request a correction."
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <Button onClick={() => setReg({ date: today })}>
              <Plus /> Regularization
            </Button>
          </>
        }
      />
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {data.locked && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" /> This month is locked for payroll
            </Badge>
          )}
          <SummaryStats s={data.summary} />
          <Card>
            <CardContent className="pt-5">
              <MonthCalendar days={data.days} onPick={(d) => !data.locked && d.date <= today && d.type !== 'inactive' && setReg({ date: d.date })} />
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">My regularization requests</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Times</TH>
                <TH>Reason</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!regs.data?.length && <EmptyRow cols={6} />}
              {regs.data?.map((r) => (
                <TR key={r._id}>
                  <TD>{fmtDate(r.date)}</TD>
                  <TD className="capitalize">{r.type.replace('-', ' ')}</TD>
                  <TD>
                    {r.checkIn ?? '—'} / {r.checkOut ?? '—'}
                  </TD>
                  <TD className="max-w-xs truncate" title={r.reason}>
                    {r.reason}
                    {r.comment && <div className="text-xs text-muted-foreground">Note: {r.comment}</div>}
                  </TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="whitespace-nowrap text-right">
                    {r.status === 'pending' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setReg({ date: r.date, request: r })}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r._id)}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <RegularizationDialog target={reg} onClose={() => setReg(null)} />
    </>
  );
}
