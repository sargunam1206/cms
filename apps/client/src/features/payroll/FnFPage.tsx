import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import type { EmployeeRef, Paged } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { inr } from './types';

interface FLine {
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  amount: number;
}
interface Preview {
  lastWorkingDay: string;
  lines: FLine[];
  total: number;
  gratuity: { eligible: boolean; years: number; estimate: number; included: boolean };
  warnings: string[];
}
interface Settlement {
  _id: string;
  employee: EmployeeRef & { exitDate?: string };
  lastWorkingDay: string;
  status: 'draft' | 'finalized';
  lines: FLine[];
  total: number;
  warnings: string[];
}
interface Extra {
  name: string;
  kind: 'earning' | 'deduction';
  amount: string;
}

export function FnFPage() {
  const { can } = useAuth();
  const list = useGet<Settlement[]>(['payroll', 'fnf'], '/payroll/fnf');
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<Settlement | null>(null);
  const finalize = useSend<string>('post', (id) => `/payroll/fnf/${id}/finalize`, { invalidate: [['payroll'], ['employees']], success: 'Settlement finalized', body: () => ({}), onSuccess: () => setView(null) });
  const del = useSend<string>('delete', (id) => `/payroll/fnf/${id}`, { invalidate: [['payroll']], success: 'Deleted', onSuccess: () => setView(null) });

  return (
    <>
      <PageHeader
        title="Full & final settlement"
        description="Exit-month salary, leave encashment, gratuity and recoveries for employees who are leaving"
        actions={can(P.PAYROLL_MANAGE) && <Button onClick={() => setCreating(true)}><Plus /> New settlement</Button>}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Last working day</TH>
                <TH>Status</TH>
                <TH>Amount payable</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!list.data?.length && <EmptyRow cols={5} text="No settlements yet" />}
              {list.data?.map((s) => (
                <TR key={s._id}>
                  <TD>
                    {s.employee.name} ({s.employee.code})
                  </TD>
                  <TD>{fmtDate(s.lastWorkingDay)}</TD>
                  <TD>
                    <Badge variant={s.status === 'finalized' ? 'success' : 'secondary'}>{s.status}</Badge>
                  </TD>
                  <TD className="font-medium tabular-nums">{inr(s.total)}</TD>
                  <TD className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setView(s)}>
                      Open
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <RulesCard canEdit={can(P.PAYROLL_MANAGE)} />

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-xl">
          {view && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Settlement · {view.employee.name}
                </DialogTitle>
                <DialogDescription>Last working day {fmtDate(view.lastWorkingDay)}</DialogDescription>
              </DialogHeader>
              <Lines lines={view.lines} total={view.total} warnings={view.warnings} />
              <DialogFooter>
                {view.status === 'draft' && can(P.PAYROLL_MANAGE) && (
                  <Button variant="ghost" onClick={() => confirm('Delete this draft?') && del.mutate(view._id)}>
                    Delete
                  </Button>
                )}
                {view.status === 'draft' && can(P.PAYROLL_APPROVE) && (
                  <Button disabled={finalize.isPending} onClick={() => confirm('Finalize? This closes the employee\'s loans and marks them as exited.') && finalize.mutate(view._id)}>
                    Finalize
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <NewSettlement open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function Lines({ lines, total, warnings }: { lines: FLine[]; total: number; warnings: string[] }) {
  return (
    <div className="space-y-2 text-sm">
      {lines.map((l, i) => (
        <div key={i} className="flex justify-between">
          <span>{l.name}</span>
          <span className={`tabular-nums ${l.kind === 'deduction' ? 'text-red-700' : ''}`}>
            {l.kind === 'deduction' ? '−' : ''}
            {inr(l.amount)}
          </span>
        </div>
      ))}
      <div className="flex justify-between border-t pt-2 text-base font-semibold">
        <span>{total >= 0 ? 'Payable to employee' : 'Recoverable from employee'}</span>
        <span className="tabular-nums">{inr(Math.abs(total))}</span>
      </div>
      {warnings.map((w) => (
        <p key={w} className="text-xs text-amber-700">
          ⚠ {w}
        </p>
      ))}
    </div>
  );
}

function NewSettlement({ open, onClose }: { open: boolean; onClose: () => void }) {
  const emps = useGet<Paged<EmployeeRef & { exitDate?: string }>>(['employees', 'leaving'], '/employees', { limit: 500, status: 'notice' }, open);
  const exited = useGet<Paged<EmployeeRef & { exitDate?: string }>>(['employees', 'exited'], '/employees', { limit: 500, status: 'active' }, open);
  const [employee, setEmployee] = useState('');
  const [gratuity, setGratuity] = useState(false);
  const [extra, setExtra] = useState<Extra[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const candidates = [...(emps.data?.items ?? []), ...(exited.data?.items ?? [])].filter((e) => e.exitDate);
  const body = () => ({ employee, includeGratuity: gratuity, extra: extra.filter((x) => x.name && Number(x.amount)).map((x) => ({ ...x, amount: Number(x.amount) })) });
  const run = useSend<void, Preview>('post', '/payroll/fnf/preview', { body, onSuccess: setPreview });
  const save = useSend('post', '/payroll/fnf', {
    invalidate: [['payroll']],
    success: 'Draft settlement saved',
    body,
    onSuccess: () => {
      setPreview(null);
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New settlement</DialogTitle>
          <DialogDescription>The employee needs an exit date (set it on the Employees page) so the last working day is known.</DialogDescription>
        </DialogHeader>
        <Field label="Employee (with an exit date)">
          <Select value={employee} onChange={(e) => { setEmployee(e.target.value); setPreview(null); }}>
            <option value="">Select…</option>
            {candidates.map((e) => (
              <option key={e._id} value={e._id}>
                {e.name} ({e.code}) · exit {fmtDate(e.exitDate)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={gratuity} onChange={(e) => { setGratuity(e.target.checked); setPreview(null); }} /> Include gratuity (estimate, if eligible)
        </label>
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Other additions / recoveries</h4>
          {extra.map((x, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <Input className="w-56" placeholder="Description" value={x.name} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <Select className="w-32" value={x.kind} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, kind: e.target.value as Extra['kind'] } : y)))}>
                <option value="earning">Add</option>
                <option value="deduction">Recover</option>
              </Select>
              <Input className="w-28" type="number" min={0} placeholder="₹" value={x.amount} onChange={(e) => setExtra(extra.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
              <Button type="button" size="icon" variant="ghost" aria-label="Remove" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={() => setExtra([...extra, { name: '', kind: 'deduction', amount: '' }])}>
            Add line
          </Button>
        </div>
        <Button variant="outline" disabled={!employee || run.isPending} onClick={() => run.mutate(undefined)}>
          Calculate
        </Button>
        {preview && (
          <div className="rounded-md border p-3">
            <Lines lines={preview.lines} total={preview.total} warnings={preview.warnings} />
            {preview.gratuity.eligible && !preview.gratuity.included && (
              <p className="mt-2 text-xs text-muted-foreground">Gratuity estimate {inr(preview.gratuity.estimate)} available; tick "Include gratuity" to add it.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button disabled={!preview || save.isPending} onClick={() => save.mutate(undefined)}>
            Save as draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Rules {
  encashmentBasis: string[];
  daysDivisor: number;
  gratuityMinYears: number;
  gratuityDays: number;
  gratuityDivisor: number;
}

function RulesCard({ canEdit }: { canEdit: boolean }) {
  const { data } = useGet<Rules>(['payroll', 'fnf-rules'], '/payroll/fnf-rules');
  const [r, setR] = useState<Rules | null>(null);
  const cur = r ?? data;
  const save = useSend('put', '/payroll/fnf-rules', { invalidate: [['payroll']], success: 'Rules saved', body: () => cur });
  if (!cur) return null;
  const num = (k: keyof Rules) => (e: React.ChangeEvent<HTMLInputElement>) => setR({ ...cur, [k]: Number(e.target.value) });
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Settlement rules</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-5">
        <Field label="Encashment pay = components">
          <Input value={cur.encashmentBasis.join(',')} disabled={!canEdit} onChange={(e) => setR({ ...cur, encashmentBasis: e.target.value.toUpperCase().split(',').map((x) => x.trim()).filter(Boolean) })} />
        </Field>
        <Field label="Days in month for daily rate">
          <Input type="number" value={cur.daysDivisor} disabled={!canEdit} onChange={num('daysDivisor')} />
        </Field>
        <Field label="Gratuity after (years)">
          <Input type="number" value={cur.gratuityMinYears} disabled={!canEdit} onChange={num('gratuityMinYears')} />
        </Field>
        <Field label="Gratuity days per year">
          <Input type="number" value={cur.gratuityDays} disabled={!canEdit} onChange={num('gratuityDays')} />
        </Field>
        <Field label="Gratuity divisor">
          <Input type="number" value={cur.gratuityDivisor} disabled={!canEdit} onChange={num('gratuityDivisor')} />
        </Field>
        {canEdit && r && (
          <div className="sm:col-span-5">
            <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
              Save rules
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground sm:col-span-5">Gratuity is an estimate: monthly encashment-basis pay × days ÷ divisor × years of service (6+ extra months count as a year). Confirm with your CA before paying.</p>
      </CardContent>
    </Card>
  );
}
