import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

interface Role {
  role: string;
  costRate: number;
  billingRate: number;
}
interface Data {
  roles: Role[];
  variance: { warnPct: number; alertPct: number };
}
const toRupees = (paise: number) => String(paise / 100);
const toPaise = (v: string) => Math.round((Number(v) || 0) * 100);

export function RateCardTab() {
  const { can } = useAuth();
  const edit = can(P.ESTIMATES_APPROVE);
  const { data } = useGet<Data>(['estimates', 'rate-card'], '/estimates/rate-card');
  const [rows, setRows] = useState<{ role: string; cost: string; bill: string }[]>([]);
  const [from, setFrom] = useState(dayjs().format('YYYY-MM-DD'));
  const [warn, setWarn] = useState('10');
  const [alert, setAlert] = useState('25');
  useEffect(() => {
    if (!data) return;
    setRows(data.roles.map((r) => ({ role: r.role, cost: toRupees(r.costRate), bill: toRupees(r.billingRate) })));
    setWarn(String(data.variance.warnPct));
    setAlert(String(data.variance.alertPct));
  }, [data]);
  const save = useSend<void>('put', '/estimates/rate-card', {
    invalidate: [['estimates']],
    success: 'Rate card saved',
    body: () => ({ effectiveFrom: from, roles: rows.map((r) => ({ role: r.role.trim(), costRate: toPaise(r.cost), billingRate: toPaise(r.bill) })) }),
  });
  const saveVar = useSend<void>('put', '/estimates/variance', { invalidate: [['estimates']], success: 'Thresholds saved', body: () => ({ warnPct: Number(warn), alertPct: Number(alert) }) });
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-5 text-sm">
          <p className="max-w-2xl text-muted-foreground">
            Rupees per hour for each role. <b>Cost</b> is what an hour of that role costs the company; <b>billing</b> is what it is charged at. Estimates freeze the rate when they are saved, so changing the card does not rewrite earlier estimates.
          </p>
          <Table>
            <THead>
              <TR>
                <TH>Role</TH>
                <TH className="w-40 text-right">Cost per hour (₹)</TH>
                <TH className="w-40 text-right">Billing per hour (₹)</TH>
                {edit && <TH className="w-10" />}
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={i}>
                  <TD>{edit ? <Input aria-label={`Role ${i + 1}`} value={r.role} onChange={(e) => set(i, { role: e.target.value })} /> : r.role}</TD>
                  <TD className="text-right">{edit ? <Input type="number" min={0} className="text-right" aria-label={`Cost per hour, ${r.role}`} value={r.cost} onChange={(e) => set(i, { cost: e.target.value })} /> : r.cost}</TD>
                  <TD className="text-right">{edit ? <Input type="number" min={0} className="text-right" aria-label={`Billing per hour, ${r.role}`} value={r.bill} onChange={(e) => set(i, { bill: e.target.value })} /> : r.bill}</TD>
                  {edit && (
                    <TD>
                      <Button variant="ghost" size="icon" aria-label={`Remove ${r.role}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                        <Trash2 />
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
          {edit && (
            <div className="flex flex-wrap items-end gap-3">
              <Button variant="outline" onClick={() => setRows([...rows, { role: '', cost: '0', bill: '0' }])}>
                <Plus /> Add role
              </Button>
              <Field label="Applies from">
                <Input type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Button disabled={save.isPending || rows.some((r) => !r.role.trim())} onClick={() => save.mutate(undefined)}>
                Save rate card
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5 text-sm">
          <p className="max-w-2xl text-muted-foreground">A project is flagged amber when its actual hours or cost run this far over the approved estimate, and red beyond the second figure.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Amber from (% over)">
              <Input type="number" min={0} className="w-32" disabled={!edit} value={warn} onChange={(e) => setWarn(e.target.value)} />
            </Field>
            <Field label="Red from (% over)">
              <Input type="number" min={0} className="w-32" disabled={!edit} value={alert} onChange={(e) => setAlert(e.target.value)} />
            </Field>
            {edit && (
              <Button disabled={saveVar.isPending} onClick={() => saveVar.mutate(undefined)}>
                Save
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
