import { useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { CheckCheck, Lock, Unlock } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useDebounced, useGet, useSend } from '@/api/hooks';
import type { AttendanceLock, Register } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { cn, fmtDate, thisMonth } from '@/lib/utils';
import { MonthPicker, PageHeader, Pager, Spinner } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { BulkOverrideDialog } from './BulkOverrideDialog';
import { dayCell } from './MonthView';
import { OverrideDialog, type OverrideTarget } from './OverrideDialog';

export function RegisterPage() {
  const { can, user } = useAuth();
  const myEmployeeId = user?.employee?._id;
  const today = dayjs().format('YYYY-MM-DD');
  const [override, setOverride] = useState<OverrideTarget | null>(null);
  const [month, setMonth] = useState(thisMonth());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const canBulk = can(P.ATTENDANCE_OVERRIDE);
  // Today if it falls in the viewed month, else the nearest day of that month
  const monthEnd = dayjs(`${month}-01`).endOf('month').format('YYYY-MM-DD');
  const defaultDate = today < `${month}-01` ? `${month}-01` : today > monthEnd ? monthEnd : today;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const dq = useDebounced(q);
  const departments = useGet<string[]>(['employees', 'departments'], '/employees/departments');
  const { data, isLoading } = useGet<Register>(['attendance', 'register'], '/attendance/register', { month, q: dq || undefined, department: department || undefined, page, limit: 100 });
  const locks = useGet<AttendanceLock[]>(['attendance', 'locks'], '/attendance/locks', undefined, can(P.ATTENDANCE_ALL));

  const inv = { invalidate: [['attendance']] };
  const lock = useSend('post', `/attendance/locks/${month}/lock`, { ...inv, success: `${month} locked`, body: () => ({ reason: 'Locked from register' }) });
  const unlock = useSend('post', `/attendance/locks/${month}/unlock`, {
    ...inv,
    success: `${month} unlocked`,
    body: () => ({ reason }),
    onSuccess: () => {
      setUnlockOpen(false);
      setReason('');
    },
  });

  return (
    <>
      <PageHeader
        title="Attendance Register"
        description={can(P.ATTENDANCE_ALL) ? 'All employees' : 'Your direct reports'}
        actions={
          <>
            <MonthPicker value={month} onChange={(m) => { setMonth(m); setPage(1); }} />
            {canBulk && !data?.locked && (
              <Button disabled={!selected.size} onClick={() => setBulkOpen(true)}>
                <CheckCheck /> Mark attendance{selected.size > 0 && ` (${selected.size})`}
              </Button>
            )}
            {can(P.ATTENDANCE_LOCK) &&
              data &&
              (data.locked ? (
                <Button variant="outline" onClick={() => setUnlockOpen(true)}>
                  <Unlock /> Unlock month
                </Button>
              ) : (
                <Button variant="outline" onClick={() => lock.mutate(undefined)} disabled={lock.isPending}>
                  <Lock /> Lock month
                </Button>
              ))}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="w-64" placeholder="Search name or code" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Select className="w-44" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }}>
          <option value="">All departments</option>
          {departments.data?.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </div>
      {data?.locked && (
        <Badge variant="secondary" className="mb-3 gap-1">
          <Lock className="h-3 w-3" /> Locked: no attendance, leave or regularization changes allowed for {month}
        </Badge>
      )}

      {isLoading || !data ? (
        <Spinner />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium">
                    <div className="flex items-center gap-2">
                      {canBulk && (
                        <Checkbox
                          aria-label="Select all employees"
                          checked={data.rows.length > 0 && selected.size === data.rows.length}
                          onChange={(e) => setSelected(e.target.checked ? new Set(data.rows.map((r) => r.employee._id)) : new Set())}
                        />
                      )}
                      Employee
                    </div>
                  </th>
                  {data.dates.map((d) => (
                    <th key={d} className={cn('w-8 px-0.5 py-2 text-center font-medium', [0].includes(dayjs(d).day()) && 'text-muted-foreground')}>
                      {dayjs(d).date()}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Late</th>
                  <th className="px-2 py-2 text-right font-medium">LOP</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employee._id} className="border-b hover:bg-muted/30">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        {canBulk && (
                          <Checkbox aria-label={`Select ${r.employee.name}`} checked={selected.has(r.employee._id)} onChange={() => toggle(r.employee._id)} />
                        )}
                        <div>
                          <Link to={`/attendance/employee/${r.employee._id}?month=${month}`} className="font-medium hover:underline">
                            {r.employee.name}
                          </Link>
                          <div className="text-muted-foreground">{r.employee.code}</div>
                        </div>
                      </div>
                    </td>
                    {r.days.map((d) => {
                      const c = dayCell(d);
                      const editable = can(P.ATTENDANCE_OVERRIDE) && !data.locked && d.type === 'working' && d.date <= today && r.employee._id !== myEmployeeId;
                      return (
                        <td
                          key={d.date}
                          className={cn('px-0.5 py-1', editable && 'cursor-pointer')}
                          title={`${fmtDate(d.date)}: ${c.title}${editable ? ' (click to edit)' : ''}`}
                          onClick={editable ? () => setOverride({ employee: r.employee, date: d.date }) : undefined}
                        >
                          <div className={cn('flex h-6 items-center justify-center rounded text-[10px] font-semibold', c.cls, editable && 'hover:ring-2 hover:ring-primary')}>
                            {c.code}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 text-right">{r.summary.lateCount}</td>
                    <td className={cn('px-2 text-right', r.summary.lopDays > 0 && 'font-semibold text-red-700')}>{r.summary.lopDays}</td>
                    <td className="px-3 text-right font-medium">{r.summary.paidDays}</td>
                  </tr>
                ))}
                {!data.rows.length && (
                  <tr>
                    <td colSpan={data.dates.length + 4} className="py-8 text-center text-muted-foreground">
                      No employees in scope
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}

      {can(P.ATTENDANCE_ALL) && !!locks.data?.length && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Lock history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {locks.data.map((l) => (
              <div key={l._id}>
                <span className="font-medium">{l.month}</span> <Badge variant={l.locked ? 'secondary' : 'warning'}>{l.locked ? 'locked' : 'unlocked'}</Badge>
                <ul className="ml-4 mt-1 list-disc text-xs text-muted-foreground">
                  {l.history.map((h, i) => (
                    <li key={i}>
                      {h.action} by {h.by?.email} on {fmtDate(h.at)} {h.reason && `: ${h.reason}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <OverrideDialog target={override} onClose={() => setOverride(null)} />
      <BulkOverrideDialog
        open={bulkOpen}
        employees={(data?.rows ?? []).filter((r) => selected.has(r.employee._id)).map((r) => r.employee)}
        defaultDate={defaultDate}
        onClose={() => {
          setBulkOpen(false);
          setSelected(new Set());
        }}
      />

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlock {month}?</DialogTitle>
            <DialogDescription>Unlocking allows changes to attendance that payroll may already use. The reason is recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <Field label="Reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="destructive" disabled={reason.trim().length < 5 || unlock.isPending} onClick={() => unlock.mutate(undefined)}>
              Unlock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
