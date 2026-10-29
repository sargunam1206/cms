import { useState } from 'react';
import dayjs from 'dayjs';
import { useGet } from '@/api/hooks';
import { PageHeader, Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PayslipDialog, type PayslipData } from './PayslipDialog';
import { inr } from './types';

export function MyPayslipsPage() {
  const { data, isLoading } = useGet<PayslipData[]>(['payroll', 'my'], '/payroll/my/payslips');
  const [open, setOpen] = useState<PayslipData | null>(null);
  if (isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="My Payslips" description="Shown after payroll for the month is approved" />
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
      <PayslipDialog slip={open} onClose={() => setOpen(null)} />
    </>
  );
}
