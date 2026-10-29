import { useState } from 'react';
import dayjs from 'dayjs';
import { toast } from 'sonner';
import { useGet, useSend } from '@/api/hooks';
import type { EmployeeRef, LeaveBalance, LeaveRequest, Paged } from '@/api/types';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Pager, Spinner } from '@/components/common/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Row {
  employee: EmployeeRef;
  balances: LeaveBalance[];
}

export function LeaveAdminPage() {
  const [year, setYear] = useState(dayjs().year());
  const [status, setStatus] = useState('');
  const [adjust, setAdjust] = useState<{ employee: EmployeeRef; balance: LeaveBalance } | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [cfOpen, setCfOpen] = useState(false);

  const rows = useGet<Row[]>(['leave', 'balances', 'all'], '/leave/balances', { year });
  const [reqPage, setReqPage] = useState(1);
  const requests = useGet<Paged<LeaveRequest>>(['leave', 'requests', 'all'], '/leave/requests', { status: status || undefined, page: reqPage, limit: 50 });
  const types = rows.data?.[0]?.balances.map((b) => b.leaveType) ?? [];

  const doAdjust = useSend('post', '/leave/balances/adjust', {
    invalidate: [['leave']],
    success: 'Balance adjusted',
    body: () => ({ employee: adjust!.employee._id, leaveType: adjust!.balance.leaveType._id, year, delta: Number(delta), reason }),
    onSuccess: () => {
      setAdjust(null);
      setDelta('');
      setReason('');
    },
  });
  const carry = useSend<void, { updated: number }>('post', '/leave/carry-forward', {
    invalidate: [['leave']],
    body: () => ({ year }),
    onSuccess: (r) => {
      setCfOpen(false);
      toast.success(`Carried forward ${r.updated} balances into ${year + 1}`);
    },
  });
  const cancel = useSend<string>('post', (id) => `/leave/requests/${id}/cancel`, {
    invalidate: [['leave'], ['attendance']],
    success: 'Leave cancelled',
    body: () => ({}),
  });

  return (
    <>
      <PageHeader
        title="Leave Management"
        actions={
          <>
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
              {[0, -1, -2, 1].map((n) => {
                const y = dayjs().year() + n;
                return (
                  <option key={y} value={y}>
                    {y}
                  </option>
                );
              })}
            </Select>
            <Button variant="outline" onClick={() => setCfOpen(true)}>
              Year-end carry forward
            </Button>
          </>
        }
      />
      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="requests">All requests</TabsTrigger>
        </TabsList>
        <TabsContent value="balances">
          {rows.isLoading ? (
            <Spinner />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Employee</TH>
                      {types.map((t) => (
                        <TH key={t._id} className="text-right">
                          {t.code}
                        </TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {!rows.data?.length && <EmptyRow cols={types.length + 1} />}
                    {rows.data?.map((r) => (
                      <TR key={r.employee._id}>
                        <TD>
                          {r.employee.name} <span className="text-muted-foreground">({r.employee.code})</span>
                        </TD>
                        {r.balances.map((b) => (
                          <TD key={b.leaveType._id} className="text-right">
                            <button className="hover:underline" title="Click to adjust" onClick={() => setAdjust({ employee: r.employee, balance: b })}>
                              <span className="font-medium">{b.available}</span>
                              <span className="text-xs text-muted-foreground"> / used {b.used}</span>
                            </button>
                          </TD>
                        ))}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="requests">
          <div className="mb-3 w-48">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setReqPage(1); }}>
              <option value="">All statuses</option>
              {['pending', 'approved', 'rejected', 'cancelled'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Employee</TH>
                    <TH>Type</TH>
                    <TH>Dates</TH>
                    <TH>Days</TH>
                    <TH>Status</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {!requests.data?.items.length && <EmptyRow cols={6} />}
                  {requests.data?.items.map((r) => (
                    <TR key={r._id}>
                      <TD>{typeof r.employee === 'string' ? r.employee : `${r.employee.name} (${r.employee.code})`}</TD>
                      <TD>{r.leaveType?.code}</TD>
                      <TD>
                        {fmtDate(r.from)} – {fmtDate(r.to)}
                      </TD>
                      <TD>{r.days}</TD>
                      <TD>
                        <StatusBadge status={r.status} />
                      </TD>
                      <TD className="text-right">
                        {['pending', 'approved'].includes(r.status) && (
                          <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r._id)}>
                            Cancel
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          {requests.data && <Pager page={requests.data.page} limit={requests.data.limit} total={requests.data.total} onPage={setReqPage} />}
        </TabsContent>
      </Tabs>

      <Dialog open={!!adjust} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Adjust {adjust?.balance.leaveType.code}: {adjust?.employee.name}
            </DialogTitle>
            <DialogDescription>
              Available {adjust?.balance.available}. Use a negative number to deduct. The change is audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Days (+/-)">
              <Input type="number" step="0.5" value={delta} onChange={(e) => setDelta(e.target.value)} />
            </Field>
            <Field label="Reason" className="col-span-2">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button disabled={!Number(delta) || reason.trim().length < 3 || doAdjust.isPending} onClick={() => doAdjust.mutate(undefined)}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cfOpen} onOpenChange={setCfOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Carry forward {year} → {year + 1}
            </DialogTitle>
            <DialogDescription>
              Sets each employee's {year + 1} opening balance to the unused {year} balance, capped by the leave type's carry-forward limit. Running it
              again recalculates and overwrites.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={carry.isPending} onClick={() => carry.mutate()}>
              Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
