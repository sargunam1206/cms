import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { PageHeader, Spinner } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LinesEditor } from './LinesEditor';
import type { PayComponent, PayLine, PayTemplate, Statutory } from './types';

export function PayrollSetupPage() {
  const { can } = useAuth();
  const canEdit = can(P.PAYROLL_MANAGE);
  return (
    <>
      <PageHeader title="Payroll setup" description="Salary components, templates and statutory rules. Rates are settings, never code." />
      <Tabs defaultValue="components">
        <TabsList>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="statutory">Statutory</TabsTrigger>
        </TabsList>
        <TabsContent value="components">
          <ComponentsTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="statutory">
          <StatutoryTab canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </>
  );
}

// ---------- Components ----------
const blankComponent: Omit<PayComponent, '_id'> = { code: '', name: '', kind: 'earning', taxable: true, prorate: true, order: 10, active: true };

function ComponentsTab({ canEdit }: { canEdit: boolean }) {
  const { data } = useGet<PayComponent[]>(['payroll', 'components'], '/payroll/components');
  const [editing, setEditing] = useState<PayComponent | 'new' | null>(null);
  return (
    <>
      {canEdit && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <Plus /> New component
          </Button>
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Order</TH>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Taxable</TH>
                <TH>Prorated</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!data?.length && <EmptyRow cols={8} text="No components yet. Add BASIC, HRA and so on." />}
              {data?.map((c) => (
                <TR key={c._id}>
                  <TD>{c.order}</TD>
                  <TD className="font-mono text-xs">{c.code}</TD>
                  <TD>{c.name}</TD>
                  <TD>{c.kind}</TD>
                  <TD>{c.kind === 'earning' ? (c.taxable ? 'Yes' : 'No') : '—'}</TD>
                  <TD>{c.kind === 'earning' ? (c.prorate ? 'Yes' : 'No') : '—'}</TD>
                  <TD>{c.active ? <Badge variant="success">active</Badge> : <Badge variant="secondary">inactive</Badge>}</TD>
                  <TD className="text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <ComponentDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function ComponentDialog({ editing, onClose }: { editing: PayComponent | 'new' | null; onClose: () => void }) {
  const isNew = editing === 'new';
  const existing = typeof editing === 'object' && editing ? editing : null;
  const [f, setF] = useState<Omit<PayComponent, '_id'>>(blankComponent);
  useEffect(() => {
    if (editing === 'new') setF(blankComponent);
    else if (editing) setF({ code: editing.code, name: editing.name, kind: editing.kind, taxable: editing.taxable, prorate: editing.prorate, order: editing.order, active: editing.active });
  }, [editing]);
  const save = useSend(isNew ? 'post' : 'put', isNew ? '/payroll/components' : `/payroll/components/${existing?._id ?? ''}`, {
    invalidate: [['payroll']],
    success: 'Saved',
    onSuccess: onClose,
    // the server needs a value to validate against the shared schema; values belong to templates, so send a placeholder
    body: () => ({ ...f, fixedAmount: 0 }),
  });
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? 'New component' : `Edit ${f.code}`}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code (capitals, e.g. HRA)">
            <Input value={f.code} disabled={!isNew} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'earning' | 'deduction' })}>
              <option value="earning">Earning</option>
              <option value="deduction">Deduction</option>
            </Select>
          </Field>
          <Field label="Order on payslip">
            <Input type="number" min={0} value={f.order} onChange={(e) => setF({ ...f, order: Number(e.target.value) })} />
          </Field>
          {f.kind === 'earning' && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.taxable} onChange={(e) => setF({ ...f, taxable: e.target.checked })} /> Taxable
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.prorate} onChange={(e) => setF({ ...f, prorate: e.target.checked })} /> Reduce for loss-of-pay days
              </label>
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
          </label>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || !f.code || !f.name} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Templates ----------
function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const { data } = useGet<PayTemplate[]>(['payroll', 'templates'], '/payroll/templates');
  const [editing, setEditing] = useState<PayTemplate | 'new' | null>(null);
  return (
    <>
      {canEdit && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <Plus /> New template
          </Button>
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Components</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!data?.length && <EmptyRow cols={3} text="No templates yet. A template is a ready-made salary layout you can start an employee from." />}
              {data?.map((t) => (
                <TR key={t._id}>
                  <TD className="font-medium">{t.name}</TD>
                  <TD className="text-xs text-muted-foreground">{t.lines.map((l) => l.code).join(', ')}</TD>
                  <TD className="text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">Changing a template does not change employees already set up from it; each employee keeps their own copy.</p>
      <TemplateDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function TemplateDialog({ editing, onClose }: { editing: PayTemplate | 'new' | null; onClose: () => void }) {
  const isNew = editing === 'new';
  const existing = typeof editing === 'object' && editing ? editing : null;
  const comps = useGet<PayComponent[]>(['payroll', 'components'], '/payroll/components', undefined, !!editing);
  const [name, setName] = useState('');
  const [lines, setLines] = useState<PayLine[]>([]);
  useEffect(() => {
    if (editing === 'new') {
      setName('');
      setLines([]);
    } else if (editing) {
      setName(editing.name);
      setLines(editing.lines);
    }
  }, [editing]);
  const save = useSend(isNew ? 'post' : 'put', isNew ? '/payroll/templates' : `/payroll/templates/${existing?._id ?? ''}`, {
    invalidate: [['payroll']],
    success: 'Saved',
    onSuccess: onClose,
    body: () => ({ name, lines }),
  });
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New salary template' : 'Edit template'}</DialogTitle>
        </DialogHeader>
        <Field label="Template name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <LinesEditor lines={lines} components={comps.data ?? []} onChange={setLines} />
        <DialogFooter>
          <Button disabled={save.isPending || name.trim().length < 2 || !lines.length} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Statutory ----------
const pct = (v: number) => Math.round(v * 10000) / 100; // 0.0075 -> 0.75
const frac = (v: string) => Number(v) / 100;

function Num({ label, value, onChange, suffix, step }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: string }) {
  return (
    <Field label={`${label}${suffix ? ` (${suffix})` : ''}`}>
      <Input type="number" step={step ?? 'any'} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

function StatutoryTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading } = useGet<Statutory>(['payroll', 'statutory'], '/payroll/statutory');
  const [s, setS] = useState<Statutory | null>(null);
  const [from, setFrom] = useState('');
  useEffect(() => {
    if (data) setS(structuredClone(data));
  }, [data]);
  const save = useSend('put', '/payroll/statutory', {
    invalidate: [['payroll']],
    success: 'Statutory rules saved',
    body: () => ({ value: s, effectiveFrom: from || undefined }),
  });
  if (isLoading || !s) return <Spinner />;
  const up = (fn: (d: Statutory) => void) => {
    const n = structuredClone(s);
    fn(n);
    setS(n);
  };

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        These are placeholder values. Have your CA verify every rate, ceiling and slab before running real payroll.
      </p>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Provident Fund (PF)</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={s.pf.enabled} onChange={(e) => up((d) => void (d.pf.enabled = e.target.checked))} /> Enabled
          </label>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Num label="Employee rate" suffix="%" value={pct(s.pf.employeeRate)} onChange={(v) => up((d) => void (d.pf.employeeRate = frac(String(v))))} />
          <Num label="Employer rate" suffix="%" value={pct(s.pf.employerRate)} onChange={(v) => up((d) => void (d.pf.employerRate = frac(String(v))))} />
          <Num label="Wage ceiling" suffix="₹/month" value={s.pf.wageCeiling} onChange={(v) => up((d) => void (d.pf.wageCeiling = v))} />
          <Field label="PF wages = these components">
            <Input value={s.pf.basisComponents.join(',')} onChange={(e) => up((d) => void (d.pf.basisComponents = e.target.value.toUpperCase().split(',').map((x) => x.trim()).filter(Boolean)))} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-4">
            <Checkbox checked={s.pf.capAtCeiling} onChange={(e) => up((d) => void (d.pf.capAtCeiling = e.target.checked))} /> Limit contribution to the wage ceiling
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">ESI</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={s.esi.enabled} onChange={(e) => up((d) => void (d.esi.enabled = e.target.checked))} /> Enabled
          </label>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Num label="Employee rate" suffix="%" value={pct(s.esi.employeeRate)} onChange={(v) => up((d) => void (d.esi.employeeRate = frac(String(v))))} />
          <Num label="Employer rate" suffix="%" value={pct(s.esi.employerRate)} onChange={(v) => up((d) => void (d.esi.employerRate = frac(String(v))))} />
          <Num label="Applies up to gross" suffix="₹/month" value={s.esi.grossThreshold} onChange={(v) => up((d) => void (d.esi.grossThreshold = v))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Professional Tax (Tamil Nadu, half-yearly)</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={s.pt.enabled} onChange={(e) => up((d) => void (d.pt.enabled = e.target.checked))} /> Enabled
          </label>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Collected in months (numbers, e.g. 9,3)">
            <Input
              className="w-48"
              value={s.pt.deductionMonths.join(',')}
              onChange={(e) => up((d) => void (d.pt.deductionMonths = e.target.value.split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= 12)))}
            />
          </Field>
          <SlabTable
            head={['Half-yearly gross up to (₹)', 'Tax (₹)']}
            rows={s.pt.slabs.map((x) => [x.upTo, x.amount])}
            onChange={(rows) => up((d) => void (d.pt.slabs = rows.map(([upTo, amount]) => ({ upTo, amount: amount ?? 0 }))))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Income tax (TDS on salary)</CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={s.tds.enabled} onChange={(e) => up((d) => void (d.tds.enabled = e.target.checked))} /> Enabled
          </label>
        </CardHeader>
        <CardContent className="space-y-4">
          <Num label="Health & education cess" suffix="%" value={pct(s.tds.cessRate)} onChange={(v) => up((d) => void (d.tds.cessRate = frac(String(v))))} />
          {(['newRegime', 'oldRegime'] as const).map((k) => (
            <div key={k} className="rounded-md border p-3">
              <h4 className="mb-2 text-sm font-semibold">{k === 'newRegime' ? 'New regime' : 'Old regime (without deductions)'}</h4>
              <div className="mb-3 grid gap-3 sm:grid-cols-3">
                <Num label="Standard deduction" suffix="₹" value={s.tds[k].standardDeduction} onChange={(v) => up((d) => void (d.tds[k].standardDeduction = v))} />
                <Num label="Rebate if income up to" suffix="₹" value={s.tds[k].rebateLimit} onChange={(v) => up((d) => void (d.tds[k].rebateLimit = v))} />
                <Num label="Maximum rebate" suffix="₹" value={s.tds[k].rebateMax} onChange={(v) => up((d) => void (d.tds[k].rebateMax = v))} />
              </div>
              <SlabTable
                head={['Income up to (₹)', 'Rate (%)']}
                rows={s.tds[k].slabs.map((x) => [x.upTo, pct(x.rate)])}
                onChange={(rows) => up((d) => void (d.tds[k].slabs = rows.map(([upTo, rate]) => ({ upTo, rate: (rate ?? 0) / 100 }))))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Effective from (blank = today)">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            Save statutory rules
          </Button>
        </div>
      )}
    </div>
  );
}

/** Two-column slab editor; an empty first column means "no upper limit" (last row). */
function SlabTable({ head, rows, onChange }: { head: [string, string]; rows: (number | null)[][]; onChange: (r: [number | null, number][]) => void }) {
  const norm = rows.map((r) => [r[0], r[1] ?? 0] as [number | null, number]);
  const set = (i: number, j: 0 | 1, raw: string) => {
    const next = norm.map((r) => [...r] as [number | null, number]);
    if (j === 0) next[i][0] = raw === '' ? null : Number(raw);
    else next[i][1] = Number(raw);
    onChange(next);
  };
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground">
        <span>{head[0]}</span>
        <span>{head[1]}</span>
        <span />
      </div>
      {norm.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input type="number" placeholder="no limit" value={r[0] ?? ''} onChange={(e) => set(i, 0, e.target.value)} />
          <Input type="number" step="any" value={r[1]} onChange={(e) => set(i, 1, e.target.value)} />
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(norm.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...norm, [null, 0]])}>
        Add slab
      </Button>
    </div>
  );
}
