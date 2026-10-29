import { useState } from 'react';
import dayjs from 'dayjs';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import type { EmployeeRef, Paged } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/common/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { inr } from './types';

function EmployeeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const emps = useGet<Paged<EmployeeRef>>(['employees', 'all'], '/employees', { limit: 500, status: 'active' });
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-64">
      <option value="">Select employee…</option>
      {emps.data?.items.map((e) => (
        <option key={e._id} value={e._id}>
          {e.name} ({e.code})
        </option>
      ))}
    </Select>
  );
}

export function AdjustmentsPage() {
  const { can } = useAuth();
  const canEdit = can(P.PAYROLL_MANAGE);
  return (
    <>
      <PageHeader title="Payroll adjustments" description="Bonuses, arrears and recoveries for a month; loans and salary advances recovered in EMIs" />
      <Tabs defaultValue="oneTime">
        <TabsList>
          <TabsTrigger value="oneTime">One-time items</TabsTrigger>
          <TabsTrigger value="loans">Loans & advances</TabsTrigger>
        </TabsList>
        <TabsContent value="oneTime">
          <OneTime canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="loans">
          <Loans canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </>
  );
}

interface Item {
  _id: string;
  employee: EmployeeRef;
  kind: 'earning' | 'deduction';
  code: string;
  name: string;
  amount: number;
  taxable: boolean;
}

function OneTime({ canEdit }: { canEdit: boolean }) {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const items = useGet<Item[]>(['payroll', 'one-time', month], '/payroll/one-time', { month });
  const [f, setF] = useState({ employee: '', kind: 'earning', code: 'BONUS', name: '', amount: '', taxable: true });
  const add = useSend('post', '/payroll/one-time', {
    invalidate: [['payroll']],
    success: 'Added',
    body: () => ({ ...f, month, amount: Number(f.amount) }),
    onSuccess: () => setF({ ...f, name: '', amount: '' }),
  });
  const del = useSend<string>('delete', (id) => `/payroll/one-time/${id}`, { invalidate: [['payroll']], success: 'Removed' });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm">Month</span>
        <Input type="month" className="w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add an item</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <Field label="Employee">
              <EmployeeSelect value={f.employee} onChange={(v) => setF({ ...f, employee: v })} />
            </Field>
            <Field label="Type">
              <Select className="w-32" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </Select>
            </Field>
            <Field label="Code">
              <Input className="w-28" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Description">
              <Input className="w-48" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Amount (₹)">
              <Input className="w-32" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </Field>
            {f.kind === 'earning' && (
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox checked={f.taxable} onChange={(e) => setF({ ...f, taxable: e.target.checked })} /> Taxable
              </label>
            )}
            <Button disabled={add.isPending || !f.employee || !f.name || !Number(f.amount)} onClick={() => add.mutate(undefined)}>
              Add
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Item</TH>
                <TH>Type</TH>
                <TH>Amount</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!items.data?.length && <EmptyRow cols={5} text="Nothing for this month" />}
              {items.data?.map((i) => (
                <TR key={i._id}>
                  <TD>
                    {i.employee.name} ({i.employee.code})
                  </TD>
                  <TD>
                    {i.name} <span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                  </TD>
                  <TD>{i.kind}</TD>
                  <TD className="tabular-nums">{inr(i.amount)}</TD>
                  <TD className="text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => del.mutate(i._id)}>
                        Remove
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Items can only be added or removed while that month's payroll run is a draft (or not yet created).</p>
    </div>
  );
}

interface LoanRow {
  _id: string;
  employee: EmployeeRef;
  principal: number;
  emi: number;
  balance: number;
  startMonth: string;
  status: 'active' | 'closed';
}

function Loans({ canEdit }: { canEdit: boolean }) {
  const loans = useGet<LoanRow[]>(['payroll', 'loans'], '/payroll/loans');
  const [f, setF] = useState({ employee: '', principal: '', emi: '', startMonth: dayjs().format('YYYY-MM') });
  const add = useSend('post', '/payroll/loans', {
    invalidate: [['payroll']],
    success: 'Loan recorded',
    body: () => ({ ...f, principal: Number(f.principal), emi: Number(f.emi) }),
    onSuccess: () => setF({ ...f, principal: '', emi: '' }),
  });
  const close = useSend<string>('post', (id) => `/payroll/loans/${id}/close`, { invalidate: [['payroll']], success: 'Loan closed', body: () => ({}) });
  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New loan / advance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <Field label="Employee">
              <EmployeeSelect value={f.employee} onChange={(v) => setF({ ...f, employee: v })} />
            </Field>
            <Field label="Amount (₹)">
              <Input className="w-32" type="number" min={0} value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} />
            </Field>
            <Field label="Monthly EMI (₹)">
              <Input className="w-32" type="number" min={0} value={f.emi} onChange={(e) => setF({ ...f, emi: e.target.value })} />
            </Field>
            <Field label="First deduction month">
              <Input className="w-40" type="month" value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value })} />
            </Field>
            <Button disabled={add.isPending || !f.employee || !Number(f.principal) || !Number(f.emi)} onClick={() => add.mutate(undefined)}>
              Record
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Amount</TH>
                <TH>EMI</TH>
                <TH>Starts</TH>
                <TH>Balance</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!loans.data?.length && <EmptyRow cols={7} text="No loans" />}
              {loans.data?.map((l) => (
                <TR key={l._id}>
                  <TD>
                    {l.employee.name} ({l.employee.code})
                  </TD>
                  <TD className="tabular-nums">{inr(l.principal)}</TD>
                  <TD className="tabular-nums">{inr(l.emi)}</TD>
                  <TD>{dayjs(`${l.startMonth}-01`).format('MMM YYYY')}</TD>
                  <TD className="tabular-nums">{inr(l.balance)}</TD>
                  <TD>
                    <StatusBadge status={l.status} />
                  </TD>
                  <TD className="text-right">
                    {canEdit && l.status === 'active' && (
                      <Button size="sm" variant="ghost" onClick={() => confirm('Stop recovering this loan? The remaining balance is written off.') && close.mutate(l._id)}>
                        Close
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">The EMI is deducted in each approved payroll run until the balance reaches zero.</p>
    </div>
  );
}
