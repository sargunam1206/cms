import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useGet } from '@/api/hooks';
import { downloadFile } from '@/lib/download';
import { cn } from '@/lib/utils';
import { PageHeader, Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { inr } from '@/features/payroll/types';
import { FLAG_LABEL, FLAG_TONE, over } from './VarianceCard';

interface Row {
  project: { _id: string; code: string; name: string; manager?: string };
  version: number;
  estHours: number;
  actHours: number;
  hoursOverPct: number | null;
  estCost: number;
  actCost: number;
  costOverPct: number | null;
  flag: 'ok' | 'warn' | 'alert' | 'none';
}

export function EstimateReportPage() {
  const { data } = useGet<Row[]>(['estimates', 'report'], '/estimates/report');
  if (!data) return <Spinner />;
  return (
    <>
      <PageHeader
        title="Estimated vs actual"
        description="Every project with an approved estimate. Actual cost uses each person's role on the rate card."
        actions={
          <Button variant="outline" onClick={() => downloadFile('/estimates/report?format=xlsx', 'estimated-vs-actual.xlsx')}>
            <Download /> Excel
          </Button>
        }
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Manager</TH>
                <TH className="text-right">Est. hours</TH>
                <TH className="text-right">Actual</TH>
                <TH className="text-right">Over</TH>
                <TH className="text-right">Est. cost</TH>
                <TH className="text-right">Actual</TH>
                <TH className="text-right">Over</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {!data.length && <EmptyRow cols={9} text="No project has an approved estimate yet" />}
              {data.map((r) => (
                <TR key={r.project._id}>
                  <TD>
                    <Link className="font-medium text-primary hover:underline" to={`/projects/${r.project._id}?tab=overview`}>
                      {r.project.code}
                    </Link>{' '}
                    <span className="text-muted-foreground">{r.project.name}</span>
                  </TD>
                  <TD>{r.project.manager}</TD>
                  <TD className="text-right tabular-nums">{r.estHours}</TD>
                  <TD className="text-right tabular-nums">{r.actHours}</TD>
                  <TD className="text-right tabular-nums">{over(r.hoursOverPct)}</TD>
                  <TD className="text-right tabular-nums">{inr(r.estCost)}</TD>
                  <TD className="text-right tabular-nums">{inr(r.actCost)}</TD>
                  <TD className="text-right tabular-nums">{over(r.costOverPct)}</TD>
                  <TD className={cn('font-medium', FLAG_TONE[r.flag])}>{FLAG_LABEL[r.flag]}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
