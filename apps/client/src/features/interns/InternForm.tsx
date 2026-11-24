import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { INTERN_SOURCE_LABEL, INTERN_SOURCES, type InternPayBasis, type InternSource, type WorkType } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import { Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form-controls';
import type { InternDetail, PersonRef } from './types';

/** What each source calls the organisation and the extra fields it needs. */
export const ORG_LABEL: Record<InternSource, string> = { college: 'College / university', company: 'Company', other: 'Organisation / referred by' };

const BLANK = {
  code: '',
  name: '',
  email: '',
  phone: '',
  department: '',
  designation: 'Intern',
  workType: 'full_time' as WorkType,
  source: 'college' as InternSource,
  organization: '',
  course: '',
  yearOfStudy: '',
  startDate: '',
  endDate: '',
  mentor: '',
  payBasis: 'monthly' as InternPayBasis,
  stipend: '0',
  hoursPerWeek: '',
  password: '',
};
type Form = typeof BLANK;

const fromDetail = (i: InternDetail): Form => ({
  ...BLANK,
  code: i.employee.code ?? '',
  name: i.employee.name,
  email: i.employee.email ?? '',
  phone: i.employee.phone ?? '',
  department: i.employee.department ?? '',
  designation: i.employee.designation ?? 'Intern',
  workType: i.employee.workType ?? 'full_time',
  source: i.source,
  organization: i.organization,
  course: i.course ?? '',
  yearOfStudy: i.yearOfStudy ?? '',
  startDate: i.startDate,
  endDate: i.endDate,
  mentor: i.mentor?._id ?? '',
  payBasis: i.payBasis,
  stipend: String((i.stipend ?? 0) / 100),
  hoursPerWeek: i.hoursPerWeek != null ? String(i.hoursPerWeek) : '',
});

/** Add an intern (editId absent) or edit one (editId = the intern's employee id). */
export function InternFormDialog({ open, editId, onClose }: { open: boolean; editId?: string; onClose: () => void }) {
  const isEdit = !!editId;
  const nav = useNavigate();
  const detail = useGet<InternDetail>(['interns', 'one', editId ?? ''], `/interns/${editId}`, undefined, open && isEdit);
  const mentors = useGet<PersonRef[]>(['interns', 'mentors'], '/interns/mentors', undefined, open);
  const [f, setF] = useState<Form>(BLANK);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return setLoadedFor(null);
    if (!isEdit && loadedFor !== 'new') {
      setF({ ...BLANK, startDate: dayjs().format('YYYY-MM-DD'), endDate: dayjs().add(3, 'month').format('YYYY-MM-DD') });
      setLoadedFor('new');
    } else if (isEdit && detail.data && loadedFor !== editId) {
      setF(fromDetail(detail.data));
      setLoadedFor(editId!);
    }
  }, [open, isEdit, editId, detail.data, loadedFor]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const hourly = f.payBasis === 'hourly';
  const body = () => {
    const { code, password, ...rest } = f;
    return {
      ...rest,
      ...(isEdit ? {} : { code, password }),
      course: f.source === 'college' ? f.course : '',
      yearOfStudy: f.source === 'college' ? f.yearOfStudy : '',
      mentor: f.mentor || null,
      stipend: Number(f.stipend) || 0,
      hoursPerWeek: hourly && f.hoursPerWeek ? Number(f.hoursPerWeek) : undefined,
    };
  };
  const save = useSend<void, { _id?: string }>(isEdit ? 'put' : 'post', isEdit ? `/interns/${editId}` : '/interns', {
    invalidate: [['interns']],
    success: isEdit ? 'Saved' : 'Intern added',
    body,
    onSuccess: (r) => {
      onClose();
      if (!isEdit && r?._id) nav(`/interns/${r._id}`);
    },
  });
  const ready = !isEdit || loadedFor === editId;
  const valid = (isEdit || !!f.code.trim()) && f.name.trim().length >= 2 && f.organization.trim().length >= 2 && !!f.startDate && !!f.endDate;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit intern' : 'Add an intern'}</DialogTitle>
        </DialogHeader>
        {!ready ? (
          <Spinner />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {!isEdit && (
                <Field label="Intern code">
                  <Input value={f.code} onChange={set('code')} placeholder="e.g. INT-2026-01" />
                </Field>
              )}
              <Field label="Full name">
                <Input value={f.name} onChange={set('name')} />
              </Field>
              <Field label="Email">
                <Input type="email" value={f.email} onChange={set('email')} />
              </Field>
              <Field label="Phone">
                <Input value={f.phone} onChange={set('phone')} />
              </Field>

              <Field label="Intern type">
                <Select
                  value={f.workType}
                  onChange={(e) => {
                    const workType = e.target.value as WorkType;
                    // part-timers are usually paid by the hour; still changeable below
                    setF({ ...f, workType, payBasis: workType === 'part_time' ? 'hourly' : f.payBasis });
                  }}
                >
                  <option value="full_time">Full time: regular office hours</option>
                  <option value="part_time">Part time: flexible hours</option>
                </Select>
              </Field>
              <Field label="Intern from">
                <Select value={f.source} onChange={set('source')}>
                  {INTERN_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {INTERN_SOURCE_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={ORG_LABEL[f.source]}>
                <Input value={f.organization} onChange={set('organization')} placeholder={f.source === 'company' ? 'e.g. ABC Infotech Pvt Ltd' : f.source === 'college' ? 'e.g. Anna University' : ''} />
              </Field>
              {f.source === 'college' && (
                <>
                  <Field label="Course">
                    <Input value={f.course} onChange={set('course')} placeholder="e.g. B.E. Computer Science" />
                  </Field>
                  <Field label="Year of study">
                    <Input value={f.yearOfStudy} onChange={set('yearOfStudy')} placeholder="e.g. Final year" />
                  </Field>
                </>
              )}

              <Field label="Department">
                <Input value={f.department} onChange={set('department')} />
              </Field>
              <Field label="Designation">
                <Input value={f.designation} onChange={set('designation')} />
              </Field>
              <Field label="Start date">
                <Input type="date" value={f.startDate} onChange={set('startDate')} />
              </Field>
              <Field label={isEdit ? 'End date (extend here)' : 'End date'}>
                <Input type="date" value={f.endDate} onChange={set('endDate')} />
              </Field>
              <Field label="Mentor">
                <Select value={f.mentor} onChange={set('mentor')}>
                  <option value="">{isEdit ? 'None' : 'Choose later'}</option>
                  {mentors.data?.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name}
                      {m.designation ? ` · ${m.designation}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Pay basis">
                <Select value={f.payBasis} onChange={set('payBasis')}>
                  <option value="monthly">Monthly stipend</option>
                  <option value="hourly">Hourly rate</option>
                </Select>
              </Field>
              <Field label={hourly ? 'Rate per hour (₹, 0 if unpaid)' : 'Monthly stipend (₹, 0 if unpaid)'}>
                <Input type="number" min={0} value={f.stipend} onChange={set('stipend')} />
              </Field>
              {hourly && (
                <Field label="Hours per week (optional)">
                  <Input type="number" min={0} max={80} value={f.hoursPerWeek} onChange={set('hoursPerWeek')} placeholder="e.g. 20" />
                </Field>
              )}
              {!isEdit && (
                <Field label="Login password (optional)" className="sm:col-span-2">
                  <Input type="password" value={f.password} onChange={set('password')} placeholder="Set one to create the intern's login now (needs the email)" autoComplete="new-password" />
                </Field>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {f.workType === 'part_time'
                ? 'Part time: no fixed shift. They check in when they start and out when they stop, as many times a day as needed (e.g. 1 hour one day, 3 hours another). Every session is recorded, and they are never marked late, half-day or absent.'
                : 'Full time: regular attendance against the office shift, like employees.'}{' '}
              {hourly ? 'The Stipend tab totals the hours worked in the month and works out the amount at this rate.' : 'No payslips; stipend is tracked on their page.'}
            </p>
          </>
        )}
        <DialogFooter>
          <Button disabled={!ready || !valid || save.isPending} onClick={() => save.mutate(undefined)}>
            {isEdit ? 'Save' : 'Add intern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Delete with a clear confirmation; goes back to the list afterwards. */
export function useDeleteIntern(after?: () => void) {
  const del = useSend<{ id: string; name: string }>('delete', (v) => `/interns/${v.id}`, { invalidate: [['interns'], ['employees'], ['projects']], success: 'Intern deleted', onSuccess: () => after?.() });
  return {
    isPending: del.isPending,
    ask: (id: string, name: string) =>
      window.confirm(
        `Delete ${name} permanently?\n\nTheir attendance, leave, timesheets, work, documents, stipend records and login are removed too. This cannot be undone.\n\nIf they simply left, use "Change status" → Completed or Dropped instead to keep the record.`,
      ) && del.mutate({ id, name }),
  };
}
