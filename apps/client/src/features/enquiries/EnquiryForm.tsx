import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import { PERMISSIONS as P } from '@cms/shared';
import { useDebounced, useGet, useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import type { Person } from '@/features/projects/types';
import type { DupMatch, EnquiryRow, Options } from './types';

const tomorrow = () => dayjs().add(1, 'day').format('YYYY-MM-DD');
const BLANK = { name: '', phone: '', email: '', company: '', source: '', nextFollowUp: tomorrow(), owner: '', note: '' };

/** New or edited enquiry. The phone number is checked against existing enquiries as it is typed. */
export function EnquiryForm({ open, enquiry, onClose, onSaved }: { open: boolean; enquiry: EnquiryRow | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const { can } = useAuth();
  const options = useGet<Options>(['enquiries', 'options'], '/enquiries/options', undefined, open);
  const people = useGet<Person[]>(['projects', 'people'], '/projects/people', undefined, open && can(P.ENQUIRIES_MANAGE));
  const [f, setF] = useState(BLANK);
  useEffect(() => {
    if (!open) return;
    setF(enquiry ? { name: enquiry.name, phone: enquiry.phone, email: enquiry.email ?? '', company: enquiry.company ?? '', source: enquiry.source, nextFollowUp: enquiry.nextFollowUp ?? '', owner: enquiry.owner._id, note: '' } : { ...BLANK, source: options.data?.sources[0] ?? '' });
  }, [open, enquiry, options.data]);
  const dp = useDebounced(f.phone, 400);
  const dup = useGet<{ matches: DupMatch[] }>(['enquiries', 'check', dp, enquiry?._id], '/enquiries/check', { phone: dp, exclude: enquiry?._id }, open && dp.replace(/\D/g, '').length >= 10);
  const matches = dp.replace(/\D/g, '').length >= 10 ? (dup.data?.matches ?? []) : [];

  const save = useSend<void, { _id: string }>(enquiry ? 'put' : 'post', enquiry ? `/enquiries/${enquiry._id}` : '/enquiries', {
    invalidate: [['enquiries']],
    success: enquiry ? 'Enquiry updated' : 'Enquiry added',
    body: () => ({ name: f.name, phone: f.phone, email: f.email, company: f.company, source: f.source, nextFollowUp: f.nextFollowUp || undefined, ...(f.owner && (enquiry ? f.owner !== enquiry.owner._id : can(P.ENQUIRIES_MANAGE)) ? { owner: f.owner } : {}), ...(enquiry ? {} : { note: f.note }) }),
    onSuccess: (r) => {
      onClose();
      onSaved?.(r._id);
    },
  });
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const closed = enquiry && (enquiry.status === options.data?.won || enquiry.status === options.data?.lost);
  const phoneOk = f.phone.replace(/\D/g, '').length >= 10;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{enquiry ? 'Edit enquiry' : 'New enquiry'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={set('phone')} inputMode="tel" />
          </Field>
          {matches.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2">
              This number is already in the system:
              <ul className="mt-1 list-disc pl-5">
                {matches.map((m, i) => (
                  <li key={i}>
                    {m._id ? (
                      <Link className="underline" to={`/enquiries/${m._id}`} onClick={onClose}>
                        {m.name}
                      </Link>
                    ) : (
                      m.name
                    )}
                    {m.company && ` (${m.company})`} · {m.status}
                    {m.owner && ` · owned by ${m.owner}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field label="Email">
            <Input type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Company">
            <Input value={f.company} onChange={set('company')} />
          </Field>
          <Field label="Source">
            <Select value={f.source} onChange={set('source')}>
              {(options.data?.sources.includes(f.source) || !f.source ? options.data?.sources : [f.source, ...(options.data?.sources ?? [])])?.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          {!closed && (
            <Field label="Next follow-up">
              <Input type="date" min={enquiry ? undefined : dayjs().format('YYYY-MM-DD')} value={f.nextFollowUp} onChange={set('nextFollowUp')} />
            </Field>
          )}
          {can(P.ENQUIRIES_MANAGE) && people.data && (
            <Field label="Owner" className="sm:col-span-2">
              <Select value={f.owner} onChange={set('owner')}>
                <option value="">Me</option>
                {people.data.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!enquiry && (
            <Field label="Note" className="sm:col-span-2">
              <Textarea rows={2} value={f.note} onChange={set('note')} />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || f.name.trim().length < 2 || !phoneOk || !f.source || (!closed && !f.nextFollowUp)} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
