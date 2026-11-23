import { useState } from 'react';
import dayjs from 'dayjs';
import { useGet } from '@/api/hooks';
import { PageHeader, Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { CardGrid, CardLine, ViewToggle, useViewMode } from '@/components/common/ViewToggle';
import { PayslipDialog, type PayslipData } from './PayslipDialog';
import { inr } from './types';

export function MyPayslipsPage() {
  const [view, setView] = useViewMode('my-payslips');
  const { data, isLoading } = useGet<PayslipData[]>(['payroll', 'my'], '/payroll/my/payslips');
  const [open, setOpen] = useState<PayslipData | null>(null);
  if (isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="My Payslips" description="Shown after payroll for the month is approved" />
      <>
        <div className="mb-2 flex justify-end">
          <ViewToggle mode={view} onChange={setView} />
        </div>
        {view === 'list' ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Month</TH>
                  <TH>Gross</TH>
                  <TH>Deductions</TH>
                  <TH>Net pay</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {!data?.length && <EmptyRow cols={5} text="No payslips yet" />}
                {data?.map((s) => (
                  <TR key={s._id}>
                    <TD className="font-medium">{dayjs(`${s.month}-01`).format('MMMM YYYY')}</TD>
                    <TD className="tabular-nums">{inr(s.gross)}</TD>
                    <TD className="tabular-nums">{inr(s.totalDeductions)}</TD>
                    <TD className="font-medium tabular-nums">{inr(s.net)}</TD>
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setOpen(s)}>
                        View
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        ) : (
        <CardGrid
          items={data}
          empty="No payslips yet."
          render={(s) => (
            <Card key={s._id} className="cursor-pointer hover:shadow-md" onClick={() => setOpen(s)}>
              <CardContent className="space-y-2 p-4">
                <div className="font-medium">{dayjs(`${s.month}-01`).format('MMMM YYYY')}</div>
                <CardLine label="Gross"><span className="tabular-nums">{inr(s.gross)}</span></CardLine>
                <CardLine label="Deductions"><span className="tabular-nums">{inr(s.totalDeductions)}</span></CardLine>
                <div className="flex items-baseline justify-between border-t pt-2">
                  <span className="text-xs text-muted-foreground">Net pay</span>
                  <span className="text-lg font-semibold tabular-nums">{inr(s.net)}</span>
                </div>
              </CardContent>
            </Card>
          )}
        />
        )}
      </>
      <PayslipDialog own slip={open} onClose={() => setOpen(null)} />
    </>
  );
}
