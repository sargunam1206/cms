import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Search } from 'lucide-react';
import { EMPLOYEE_STATUS, PERMISSIONS as P, TAX_REGIMES, employeeSchema, type EmployeeInput } from '@cms/shared';
import { useDebounced, useGet, useSend } from '@/api/hooks';
import type { Employee, Paged } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { SalaryDialog } from '@/features/payroll/SalaryDialog';
import { PageHeader } from '@/components/common/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export function EmployeesPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [department, setDepartment] = useState('');
  const [salaryFor, setSalaryFor] = useState<Employee | null>(null);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const departments = useGet<string[]>(['employees', 'departments'], '/employees/departments');
  const LIMIT = 50;
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const { data } = useGet<Paged<Employee>>(['employees'], '/employees', { q: dq || undefined, status: status || undefined, department: department || undefined, page, limit: LIMIT });

  return (
    <>
      <PageHeader
        title="Employees"
        description={data ? `${data.total} employees` : undefined}
        actions={
          can(P.EMPLOYEES_MANAGE) && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> Add employee
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, code, email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Select className="w-44" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }}>
          <option value="">All departments</option>
          {departments.data?.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All</option>
          {EMPLOYEE_STATUS.map((s) => (
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
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Department</TH>
                <TH>Designation</TH>
                <TH>Manager</TH>
                <TH>Joined</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!data?.items.length && <EmptyRow cols={8} />}
              {data?.items.map((e) => (
                <TR key={e._id}>
                  <TD className="font-mono text-xs">{e.code}</TD>
                  <TD className="font-medium">
                    {e.name}
                    <div className="text-xs font-normal text-muted-foreground">{e.email}</div>
                  </TD>
                  <TD>{e.department}</TD>
                  <TD>{e.designation}</TD>
                  <TD>{e.manager?.name ?? '—'}</TD>
                  <TD>{fmtDate(e.dateOfJoining)}</TD>
                  <TD>
                    <StatusBadge status={e.status} />
                  </TD>
                  <TD className="whitespace-nowrap text-right">
                    {can(P.ATTENDANCE_ALL) && (
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/attendance/employee/${e._id}`}>Attendance</Link>
                      </Button>
                    )}
                    {can(P.PAYROLL_VIEW, P.PAYROLL_MANAGE) && (
                      <Button size="sm" variant="ghost" onClick={() => setSalaryFor(e)}>
                        Salary
                      </Button>
                    )}
                    {can(P.EMPLOYEES_MANAGE) && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
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
      {data && data.total > LIMIT && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {Math.ceil(data.total / LIMIT)}
          </span>
          <Button size="sm" variant="outline" disabled={page >= Math.ceil(data.total / LIMIT)} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      <SalaryDialog employee={salaryFor} onClose={() => setSalaryFor(null)} />
      <EmployeeDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

const blank: EmployeeInput = {
  code: '',
  name: '',
  email: '',
  phone: '',
  department: '',
  designation: '',
  manager: null,
  dateOfJoining: '',
  dateOfBirth: '',
  pan: '',
  uan: '',
  esiNumber: '',
  bank: { accountNumber: '', ifsc: '', bankName: '' },
  pfApplicable: true,
  esiApplicable: false,
  taxRegime: 'new',
  status: 'active',
  exitDate: '',
};

function EmployeeDialog({ editing, onClose }: { editing: Employee | 'new' | null; onClose: () => void }) {
  const isNew = editing === 'new';
  const all = useGet<Paged<Employee>>(['employees', 'all'], '/employees', { limit: 500, status: 'active' }, !!editing);
  const { register, handleSubmit, reset, watch, formState } = useForm<EmployeeInput>({ resolver: zodResolver(employeeSchema) });

  useEffect(() => {
    if (!editing) return;
    if (editing === 'new') return reset(blank);
    reset({
      ...blank,
      ...Object.fromEntries(Object.entries(editing).filter(([, v]) => v != null)),
      manager: editing.manager?._id ?? null,
      bank: { ...blank.bank, ...editing.bank },
    } as EmployeeInput);
  }, [editing, reset]);

  const save = useSend<EmployeeInput>(isNew ? 'post' : 'put', isNew ? '/employees' : `/employees/${editing?._id ?? ''}`, {
    invalidate: [['employees']],
    success: isNew ? 'Employee added' : 'Employee updated',
    onSuccess: onClose,
  });
  const e = formState.errors;
  const selfId = editing && editing !== 'new' ? editing._id : undefined;

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add employee' : 'Edit employee'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => save.mutate({ ...v, manager: v.manager || null }))} className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-3">
            <Field label="Employee code" error={e.code?.message}>
              <Input {...register('code')} />
            </Field>
            <Field label="Full name" error={e.name?.message} className="sm:col-span-2">
              <Input {...register('name')} />
            </Field>
            <Field label="Email" error={e.email?.message}>
              <Input type="email" {...register('email')} />
            </Field>
            <Field label="Phone">
              <Input {...register('phone')} />
            </Field>
            <Field label="Date of birth">
              <Input type="date" {...register('dateOfBirth')} />
            </Field>
            <Field label="Department">
              <Input {...register('department')} />
            </Field>
            <Field label="Designation">
              <Input {...register('designation')} />
            </Field>
            <Field label="Reports to">
              <Select {...register('manager')}>
                <option value="">—</option>
                {all.data?.items
                  .filter((m) => m._id !== selfId)
                  .map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name} ({m.code})
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Date of joining" error={e.dateOfJoining?.message}>
              <Input type="date" {...register('dateOfJoining')} />
            </Field>
            <Field label="Status">
              <Select {...register('status')}>
                {EMPLOYEE_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            {watch('status') !== 'active' && (
              <Field label="Exit date">
                <Input type="date" {...register('exitDate')} />
              </Field>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Statutory & bank (used by payroll)</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="PAN" error={e.pan?.message}>
                <Input {...register('pan')} />
              </Field>
              <Field label="UAN (PF)">
                <Input {...register('uan')} />
              </Field>
              <Field label="ESI number">
                <Input {...register('esiNumber')} />
              </Field>
              <Field label="Bank account no.">
                <Input {...register('bank.accountNumber')} />
              </Field>
              <Field label="IFSC">
                <Input {...register('bank.ifsc')} />
              </Field>
              <Field label="Bank name">
                <Input {...register('bank.bankName')} />
              </Field>
              <Field label="Tax regime">
                <Select {...register('taxRegime')}>
                  {TAX_REGIMES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <Checkbox {...register('pfApplicable')} /> PF applicable
              </label>
              <label className="flex items-center gap-2 pt-6 text-sm">
                <Checkbox {...register('esiApplicable')} /> ESI applicable
              </label>
            </div>
          </section>

          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
