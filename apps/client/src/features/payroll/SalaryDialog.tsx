import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import type { EmployeeRef } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { LinesEditor } from './LinesEditor';
import { inr, type PayComponent, type PayLine, type PayStructure, type PayTemplate, type Preview } from './types';

/** An employee's salary structure history, a form for a new revision, and a live "what would they be paid" preview. */
export function SalaryDialog({ employee, onClose }: { employee: EmployeeRef | null; onClose: () => void }) {
  const { can } = useAuth();
  const canEdit = can(P.PAYROLL_MANAGE);
  const open = !!employee;
  const id = employee?._id ?? '';

  const history = useGet<PayStructure[]>(['payroll', 'structure', id], `/payroll/structures/${id}`, undefined, open);
  const comps = useGet<PayComponent[]>(['payroll', 'components'], '/payroll/components', undefined, open);
  const templates = useGet<PayTemplate[]>(['payroll', 'templates'], '/payroll/templates', undefined, open && canEdit);

  const [from, setFrom] = useState('');
  const [lines, setLines] = useState<PayLine[]>([]);
  const [tpl, setTpl] = useState('');
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));

  const latest = history.data?.[0];
  useEffect(() => {
    if (!open) return;
    setFrom(dayjs().startOf('month').format('YYYY-MM-DD'));
    setTpl('');
    setLines(latest?.lines ?? []);
  }, [open, latest?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useSend('post', `/payroll/structures/${id}`, {
    invalidate: [['payroll']],
    success: 'Salary structure saved',
    body: () => ({ effectiveFrom: from, template: tpl || undefined, lines }),
  });
  const preview = useGet<Preview>(['payroll', 'preview', id, month], `/payroll/preview/${id}`, { month }, open && !!latest);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Salary · {employee?.name} ({employee?.code})
          </DialogTitle>
          <DialogDescription>Revisions apply from their effective date. Earlier months keep the structure that was in force then.</DialogDescription>
        </DialogHeader>

        <section>
          <h4 className="mb-1 text-sm font-semibold">History</h4>
          {!history.data?.length ? (
            <p className="text-sm text-muted-foreground">No salary structure yet.</p>
          ) : (
            <ul className="text-sm">
              {history.data.map((s) => (
                <li key={s._id} className="flex justify-between border-b py-1 last:border-0">
                  <span>From {fmtDate(s.effectiveFrom)}</span>
                  <span className="text-muted-foreground">{s.lines.map((l) => l.code).join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {canEdit && (
          <section className="space-y-3 rounded-md border p-3">
            <h4 className="text-sm font-semibold">{latest ? 'New revision' : 'Set salary'}</h4>
            <div className="flex flex-wrap gap-3">
              <Field label="Effective from">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Start from template">
                <Select
                  className="w-56"
                  value={tpl}
                  onChange={(e) => {
                    setTpl(e.target.value);
                    const t = templates.data?.find((x) => x._id === e.target.value);
                    if (t) setLines(structuredClone(t.lines));
                  }}
                >
                  <option value="">None</option>
                  {templates.data?.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <LinesEditor lines={lines} components={comps.data ?? []} onChange={setLines} />
            <Button disabled={save.isPending || !from || !lines.length} onClick={() => save.mutate(undefined)}>
              Save revision
            </Button>
          </section>
        )}

        {latest && (
          <section className="space-y-2">
            <div className="flex items-end gap-3">
              <h4 className="text-sm font-semibold">Preview</h4>
              <Input type="month" className="w-40" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Preview month" />
            </div>
            {preview.isError && <p className="text-sm text-destructive">No salary structure applies to that month.</p>}
            {preview.data && <PreviewTable p={preview.data} />}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PreviewTable({ p }: { p: Preview }) {
  const col = (title: string, rows: Preview['earnings'], total?: number) => (
    <div>
      <h5 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</h5>
      {rows.map((r) => (
        <div key={r.code} className="flex justify-between text-sm">
          <span>
            {r.name}
            {r.note && <span className="ml-1 text-xs text-muted-foreground">({r.note})</span>}
          </span>
          <span className="tabular-nums">{inr(r.amount)}</span>
        </div>
      ))}
      {total !== undefined && (
        <div className="mt-1 flex justify-between border-t pt-1 text-sm font-medium">
          <span>Total</span>
          <span className="tabular-nums">{inr(total)}</span>
        </div>
      )}
    </div>
  );
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">
        Paid days {p.paidDays} of {p.totalDays}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {col('Earnings', p.earnings, p.gross)}
        {col('Deductions', p.deductions, p.totalDeductions)}
      </div>
      <div className="flex justify-between border-t pt-2 text-base font-semibold">
        <span>Net pay</span>
        <span className="tabular-nums">{inr(p.net)}</span>
      </div>
      {p.employerContributions.length > 0 && (
        <p className="text-xs text-muted-foreground">Employer contributions: {p.employerContributions.map((e) => `${e.name} ${inr(e.amount)}`).join(' · ')}</p>
      )}
      {p.warnings.map((w) => (
        <p key={w} className="text-sm text-amber-700">
          ⚠ {w}
        </p>
      ))}
    </div>
  );
}
