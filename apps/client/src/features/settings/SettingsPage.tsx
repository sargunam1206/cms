import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import {
  LEAVE_ACCRUAL,
  PERMISSIONS as P,
  leaveTypeSchema,
  workCalendarSchema,
  type LeaveTypeInput,
  type WorkCalendarSettings,
} from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import type { Holiday, LeaveType } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function SettingsPage() {
  const { can } = useAuth();
  const first = can(P.SETTINGS_MANAGE) ? 'calendar' : can(P.HOLIDAYS_MANAGE) ? 'holidays' : 'leave';
  return (
    <>
      <PageHeader title="Settings" description="Rules here drive attendance and payroll; nothing is hard-coded." />
      <Tabs defaultValue={first}>
        <TabsList>
          {can(P.SETTINGS_MANAGE) && <TabsTrigger value="calendar">Work calendar</TabsTrigger>}
          {can(P.HOLIDAYS_MANAGE) && <TabsTrigger value="holidays">Holidays</TabsTrigger>}
          {can(P.LEAVE_MANAGE) && <TabsTrigger value="leave">Leave types</TabsTrigger>}
        </TabsList>
        <TabsContent value="calendar">
          <WorkCalendarForm />
        </TabsContent>
        <TabsContent value="holidays">
          <Holidays />
        </TabsContent>
        <TabsContent value="leave">
          <LeaveTypes />
        </TabsContent>
      </Tabs>
    </>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function WorkCalendarForm() {
  const current = useGet<WorkCalendarSettings>(['settings', 'work-calendar'], '/settings/work-calendar');
  const [effectiveFrom, setEffectiveFrom] = useState(dayjs().format('YYYY-MM-DD'));
  const { register, handleSubmit, reset, watch, setValue, formState } = useForm<WorkCalendarSettings>({ resolver: zodResolver(workCalendarSchema) });
  useEffect(() => {
    if (current.data) reset(current.data);
  }, [current.data, reset]);

  const save = useSend<WorkCalendarSettings>('put', '/settings/work-calendar', {
    invalidate: [['settings'], ['attendance']],
    success: 'Work calendar saved',
    body: (v) => ({ value: v, effectiveFrom }),
  });

  const weeklyOffs = watch('weeklyOffs') ?? [];
  const satOff = watch('saturdaysOff') ?? [];
  const toggleIn = (key: 'weeklyOffs' | 'saturdaysOff', list: number[], n: number) =>
    setValue(key, list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort(), { shouldDirty: true });
  const num = { valueAsNumber: true };
  const e = formState.errors;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Working days & attendance rules</CardTitle>
        <CardDescription>Changes are effective-dated, so past months keep the rules they were calculated with.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={handleSubmit((v) => save.mutate(v))}>
          <div>
            <div className="mb-2 text-sm font-medium">Weekly offs</div>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={weeklyOffs.includes(i)} onChange={() => toggleIn('weeklyOffs', weeklyOffs, i)} /> {d}
                </label>
              ))}
            </div>
          </div>
          {!weeklyOffs.includes(6) && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Saturdays">
                <Select {...register('saturdayRule')}>
                  <option value="working">All Saturdays working</option>
                  <option value="alternate">Some Saturdays off</option>
                  <option value="off">All Saturdays off</option>
                </Select>
              </Field>
              {watch('saturdayRule') === 'alternate' && (
                <div className="sm:col-span-2">
                  <div className="mb-2 text-sm font-medium">Which Saturdays are off</div>
                  <div className="flex flex-wrap gap-3">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label key={n} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={satOff.includes(n)} onChange={() => toggleIn('saturdaysOff', satOff, n)} />
                        {['1st', '2nd', '3rd', '4th', '5th'][n - 1]}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Shift start" error={e.shiftStart?.message}>
              <Input type="time" {...register('shiftStart')} />
            </Field>
            <Field label="Shift end" error={e.shiftEnd?.message}>
              <Input type="time" {...register('shiftEnd')} />
            </Field>
            <Field label="Grace (minutes)" error={e.graceMinutes?.message}>
              <Input type="number" {...register('graceMinutes', num)} />
            </Field>
            <Field label="Min hours: full day" error={e.minHoursFullDay?.message}>
              <Input type="number" step="0.25" {...register('minHoursFullDay', num)} />
            </Field>
            <Field label="Min hours: half day" error={e.minHoursHalfDay?.message}>
              <Input type="number" step="0.25" {...register('minHoursHalfDay', num)} />
            </Field>
            <Field label="Effective from">
              <Input type="date" value={effectiveFrom} onChange={(ev) => setEffectiveFrom(ev.target.value)} />
            </Field>
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox {...register('lateLopEnabled')} /> Convert late marks into loss of pay (LOP)
            </label>
            {watch('lateLopEnabled') ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                Every
                <Input type="number" className="w-20" min={1} {...register('lateMarksPerHalfDay', num)} />
                late marks = ½ day LOP
                {e.lateMarksPerHalfDay && <span className="text-xs text-destructive">{e.lateMarksPerHalfDay.message}</span>}
                <span className="ml-2">after the first</span>
                <Input type="number" className="w-20" min={0} {...register('lateFreeAllowance', num)} />
                free late marks each month
                {e.lateFreeAllowance && <span className="text-xs text-destructive">{e.lateFreeAllowance.message}</span>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Off: late arrivals are still recorded, but they never reduce pay.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Even when this is on, HR can excuse a late mark for a specific day (an employee's attendance page, "Late marks" panel), and excused marks do not count.
            </p>
          </div>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Holidays() {
  const [year, setYear] = useState(dayjs().year());
  const [form, setForm] = useState({ date: '', name: '', optional: false });
  const list = useGet<Holiday[]>(['holidays'], '/holidays', { year });
  const add = useSend('post', '/holidays', {
    invalidate: [['holidays'], ['attendance']],
    success: 'Holiday added',
    body: () => form,
    onSuccess: () => setForm({ date: '', name: '', optional: false }),
  });
  const del = useSend<string>('delete', (id) => `/holidays/${id}`, { invalidate: [['holidays'], ['attendance']], success: 'Removed' });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Holiday calendar</CardTitle>
        <Select className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[-1, 0, 1].map((n) => (
            <option key={n} value={dayjs().year() + n}>
              {dayjs().year() + n}
            </option>
          ))}
        </Select>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Name" className="min-w-[220px] flex-1">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pongal" />
          </Field>
          <label className="flex h-9 items-center gap-2 text-sm">
            <Checkbox checked={form.optional} onChange={(e) => setForm({ ...form, optional: e.target.checked })} /> Restricted / optional
          </label>
          <Button disabled={!form.date || !form.name || add.isPending} onClick={() => add.mutate(undefined)}>
            <Plus /> Add
          </Button>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Day</TH>
              <TH>Name</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {!list.data?.length && <EmptyRow cols={4} text="No holidays for this year" />}
            {list.data?.map((h) => (
              <TR key={h._id}>
                <TD>{fmtDate(h.date)}</TD>
                <TD>{dayjs(h.date).format('dddd')}</TD>
                <TD>
                  {h.name} {h.optional && <Badge variant="secondary">optional</Badge>}
                </TD>
                <TD className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => del.mutate(h._id)} aria-label="Delete">
                    <Trash2 />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function LeaveTypes() {
  const list = useGet<LeaveType[]>(['leave', 'types'], '/leave/types');
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const isNew = editing === 'new';
  const { register, handleSubmit, reset, formState } = useForm<LeaveTypeInput>({ resolver: zodResolver(leaveTypeSchema) });
  useEffect(() => {
    if (editing === 'new')
      reset({ code: '', name: '', paid: true, annualQuota: 0, accrual: 'yearly', carryForwardMax: 0, encashable: false, allowHalfDay: true, active: true });
    else if (editing) reset(editing);
  }, [editing, reset]);
  const save = useSend<LeaveTypeInput>(isNew ? 'post' : 'put', isNew ? '/leave/types' : `/leave/types/${editing?._id ?? ''}`, {
    invalidate: [['leave']],
    success: 'Leave type saved',
    onSuccess: () => setEditing(null),
  });
  const num = { valueAsNumber: true };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Leave types</CardTitle>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> Add
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Paid</TH>
              <TH>Quota / yr</TH>
              <TH>Accrual</TH>
              <TH>Carry fwd max</TH>
              <TH>Encashable</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {list.data?.map((t) => (
              <TR key={t._id}>
                <TD className="font-medium">{t.code}</TD>
                <TD>{t.name}</TD>
                <TD>{t.paid ? 'Yes' : 'No (LOP)'}</TD>
                <TD>{t.paid ? t.annualQuota : '—'}</TD>
                <TD className="capitalize">{t.accrual}</TD>
                <TD>{t.carryForwardMax}</TD>
                <TD>{t.encashable ? 'Yes' : 'No'}</TD>
                <TD>{t.active ? <Badge variant="success">active</Badge> : <Badge variant="secondary">inactive</Badge>}</TD>
                <TD className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add leave type' : 'Edit leave type'}</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Code" error={formState.errors.code?.message}>
                <Input {...register('code')} />
              </Field>
              <Field label="Name" className="col-span-2" error={formState.errors.name?.message}>
                <Input {...register('name')} />
              </Field>
              <Field label="Annual quota">
                <Input type="number" step="0.5" {...register('annualQuota', num)} />
              </Field>
              <Field label="Accrual">
                <Select {...register('accrual')}>
                  {LEAVE_ACCRUAL.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Carry forward max">
                <Input type="number" step="0.5" {...register('carryForwardMax', num)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {(['paid', 'encashable', 'allowHalfDay', 'active'] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <Checkbox {...register(k)} /> {{ paid: 'Paid', encashable: 'Encashable', allowHalfDay: 'Half day allowed', active: 'Active' }[k]}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={save.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
