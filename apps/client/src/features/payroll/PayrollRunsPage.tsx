import { useState } from 'react';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { downloadFile } from '@/lib/download';
import { PERMISSIONS as P } from '@cms/shared';
import { api } from '@/api/client';
import { useGet, useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Spinner, Stat } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { PayslipDialog, type PayslipData } from './PayslipDialog';
import { inr } from './types';

type Status = 'draft' | 'hr_reviewed' | 'approved';
interface Run {
  _id: string;
  month: string;
  status: Status;
  totals: { employees: number; gross: number; deductions: number; net: number; employerContributions: number };
  skipped: { employee: string; name: string; code: string; reason: string }[];
  computedAt?: string;
  history: { action: string; at: string; comment?: string }[];
}
interface SlipRow {
  _id: string;
  person: { name: string; code: string };
  attendance: { paidDays: number; totalDays: number };
  gross: number;
  totalDeductions: number;
  net: number;
  warnings: string[];
}

const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', hr_reviewed: 'Awaiting approval', approved: 'Approved' };
const statusBadge = (s: Status) => <Badge variant={s === 'approved' ? 'success' : s === 'hr_reviewed' ? 'warning' : 'secondary'}>{STATUS_LABEL[s]}</Badge>;

export function PayrollRunsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const runs = useGet<Run[]>(['payroll', 'runs'], '/payroll/runs');
  const [month, setMonth] = useState(dayjs().subtract(1, 'month').format('YYYY-MM'));
  const [creating, setCreating] = useState(false);
  const create = useSend<string, Run>('post', '/payroll/runs', {
    invalidate: [['payroll'], ['attendance']],
    body: (m) => ({ month: m }),
    success: 'Payroll run created',
    onSuccess: (r) => nav(`/payroll/runs/${r._id}`),
  });
  return (
    <>
      <PageHeader
        title="Payroll runs"
        description="One run per month: compute, HR review, management approval"
        actions={can(P.PAYROLL_MANAGE) && <Button onClick={() => setCreating(true)}><Plus /> New run</Button>}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Month</TH>
                <TH>Status</TH>
                <TH>Employees</TH>
                <TH>Gross</TH>
                <TH>Net pay</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!runs.data?.length && <EmptyRow cols={6} text="No payroll runs yet" />}
              {runs.data?.map((r) => (
                <TR key={r._id}>
                  <TD className="font-medium">{dayjs(`${r.month}-01`).format('MMMM YYYY')}</TD>
                  <TD>{statusBadge(r.status)}</TD>
                  <TD>{r.totals?.employees ?? 0}</TD>
                  <TD className="tabular-nums">{inr(r.totals?.gross ?? 0)}</TD>
                  <TD className="tabular-nums">{inr(r.totals?.net ?? 0)}</TD>
                  <TD className="text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/payroll/runs/${r._id}`}>Open</Link>
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New payroll run</DialogTitle>
          </DialogHeader>
          <Field label="Month (must have ended)">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          <p className="text-sm text-muted-foreground">Creating a run locks that month's attendance, leave and regularization changes.</p>
          <DialogFooter>
            <Button disabled={create.isPending || !month} onClick={() => create.mutate(month, { onSuccess: () => setCreating(false) })}>
              Create run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PayrollRunPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { data, isLoading } = useGet<{ run: Run; payslips: SlipRow[] }>(['payroll', 'run', id], `/payroll/runs/${id}`);
  const [slip, setSlip] = useState<PayslipData | null>(null);
  const [ask, setAsk] = useState<null | 'reject' | 'reopen'>(null);
  const [text, setText] = useState('');

  const inv = { invalidate: [['payroll']] };
  const post = (action: string, success: string) => useSend<void>('post', `/payroll/runs/${id}/${action}`, { ...inv, success, body: () => ({}) }); // eslint-disable-line react-hooks/rules-of-hooks
  const compute = post('compute', 'Payslips calculated');
  const submit = post('submit', 'Submitted');
  const approve = post('approve', 'Run approved');
  const reasoned = useSend<{ action: 'reject' | 'reopen'; text: string }>('post', (v) => `/payroll/runs/${id}/${v.action}`, {
    ...inv,
    success: 'Done',
    body: (v) => (v.action === 'reject' ? { comment: v.text } : { reason: v.text }),
    onSuccess: () => {
      setAsk(null);
      setText('');
    },
  });
  const del = useSend<void>('delete', `/payroll/runs/${id}`, { ...inv, success: 'Run deleted', onSuccess: () => nav('/payroll/runs') });

  if (isLoading || !data) return <Spinner />;
  const { run, payslips } = data;
  const manage = can(P.PAYROLL_MANAGE);
  const warnCount = payslips.filter((p) => p.warnings.length).length;

  const openSlip = async (sid: string) => setSlip((await api.get<PayslipData>(`/payroll/payslips/${sid}`)).data);

  return (
    <>
      <PageHeader
        title={`Payroll · ${dayjs(`${run.month}-01`).format('MMMM YYYY')}`}
        description={run.computedAt ? `Last calculated ${fmtDate(run.computedAt)}` : 'Not calculated yet'}
        actions={
          <>
            {statusBadge(run.status)}
            {manage && run.status === 'draft' && (
              <>
                <Button variant="outline" disabled={compute.isPending} onClick={() => compute.mutate(undefined)}>
                  {run.computedAt ? 'Recalculate' : 'Calculate payslips'}
                </Button>
                <Button disabled={submit.isPending || !run.totals?.employees} onClick={() => submit.mutate(undefined)}>
                  Submit for approval
                </Button>
              </>
            )}
            {can(P.PAYROLL_APPROVE) && run.status === 'hr_reviewed' && (
              <>
                <Button disabled={approve.isPending} onClick={() => approve.mutate(undefined)}>
                  Approve
                </Button>
                <Button variant="outline" onClick={() => setAsk('reject')}>
                  Send back
                </Button>
              </>
            )}
            {manage && run.status === 'approved' && (
              <Button variant="outline" onClick={() => setAsk('reopen')}>
                Reopen
              </Button>
            )}
            {manage && run.status === 'draft' && (
              <Button variant="ghost" onClick={() => confirm('Delete this draft run and its payslips?') && del.mutate(undefined)}>
                Delete
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Employees paid" value={run.totals?.employees ?? 0} />
        <Stat label="Gross" value={inr(run.totals?.gross ?? 0)} />
        <Stat label="Deductions" value={inr(run.totals?.deductions ?? 0)} />
        <Stat label="Net pay" value={inr(run.totals?.net ?? 0)} tone="good" />
      </div>
      {warnCount > 0 && <p className="mb-3 text-sm text-amber-700">⚠ {warnCount} payslip(s) have warnings. Open them to review.</p>}

      {run.skipped?.length > 0 && (
        <Card className="mb-4 border-amber-300">
          <CardContent className="pt-4">
            <h4 className="mb-1 text-sm font-semibold">Not included ({run.skipped.length})</h4>
            <ul className="text-sm">
              {run.skipped.map((s) => (
                <li key={s.employee}>
                  {s.name} ({s.code}): <span className="text-muted-foreground">{s.reason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Paid days</TH>
                <TH>Gross</TH>
                <TH>Deductions</TH>
                <TH>Net pay</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!payslips.length && <EmptyRow cols={6} text="Calculate the run to generate payslips" />}
              {payslips.map((p) => (
                <TR key={p._id}>
                  <TD className="font-medium">
                    {p.person.name} <span className="text-xs text-muted-foreground">{p.person.code}</span>
                    {p.warnings.length > 0 && <span title={p.warnings.join('; ')}> ⚠</span>}
                  </TD>
                  <TD>
                    {p.attendance.paidDays}/{p.attendance.totalDays}
                  </TD>
                  <TD className="tabular-nums">{inr(p.gross)}</TD>
                  <TD className="tabular-nums">{inr(p.totalDeductions)}</TD>
                  <TD className="font-medium tabular-nums">{inr(p.net)}</TD>
                  <TD className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openSlip(p._id)}>
                      View
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {run.totals?.employees > 0 && (
        <Card className="mt-4">
          <CardContent className="flex flex-wrap items-center gap-2 pt-4">
            <span className="mr-2 text-sm font-medium">Downloads</span>
            {run.status === 'approved' && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const h = await downloadFile(`/payroll/runs/${run._id}/bank`, `bank-transfer-${run.month}.xlsx`);
                  if (h && Number(h['x-missing-bank-details']) > 0) toast.warning(`${h['x-missing-bank-details']} employee(s) have no bank details; see the "Missing bank details" sheet`);
                }}
              >
                <Download /> Bank transfer file
              </Button>
            )}
            {(
              [['salary-register', 'Salary register'], ['pf', 'PF'], ['esi', 'ESI'], ['pt', 'Professional tax'], ['tds', 'TDS']] as const
            ).map(([t, label]) => (
              <Button key={t} size="sm" variant="outline" onClick={() => downloadFile(`/payroll/runs/${run._id}/reports/${t}`, `${t}-${run.month}.xlsx`)}>
                <Download /> {label}
              </Button>
            ))}
            {run.status !== 'approved' && <span className="text-xs text-muted-foreground">Bank file unlocks after approval. Reports from a draft are for review only.</span>}
          </CardContent>
        </Card>
      )}

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted-foreground">History</summary>
        <ul className="mt-2 space-y-1">
          {run.history.map((h, i) => (
            <li key={i}>
              {fmtDate(h.at)} · {h.action}
              {h.comment ? `: ${h.comment}` : ''}
            </li>
          ))}
        </ul>
      </details>

      <PayslipDialog slip={slip} onClose={() => setSlip(null)} />
      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ask === 'reject' ? 'Send back to HR' : 'Reopen approved payroll'}</DialogTitle>
          </DialogHeader>
          <Field label={ask === 'reject' ? 'What needs fixing?' : 'Reason (recorded in the audit log)'}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button disabled={text.trim().length < 5 || reasoned.isPending} onClick={() => ask && reasoned.mutate({ action: ask, text })}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
