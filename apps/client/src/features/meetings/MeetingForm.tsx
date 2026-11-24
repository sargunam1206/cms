import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { MEETING_TYPES } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import { PeoplePicker } from '@/components/common/PeoplePicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { personId, typeLabel, type MeetingAction, type MeetingDetail, type MeetingOptions } from './types';
import { PersonOptions } from '@/components/common/PersonOptions';

interface FormState {
  title: string;
  type: string;
  date: string;
  start: string;
  end: string;
  location: string;
  link: string;
  attendees: string[];
  guests: string;
  agenda: string;
  minutes: string;
  project: string;
  client: string;
  actions: { _id?: string; text: string; owner: string; dueDate: string; done: boolean }[];
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = (date?: string, project?: string): FormState => ({
  title: '',
  type: 'internal',
  date: date ?? today(),
  start: '10:00',
  end: '11:00',
  location: '',
  link: '',
  attendees: [],
  guests: '',
  agenda: '',
  minutes: '',
  project: project ?? '',
  client: '',
  actions: [],
});

const fromMeeting = (m: MeetingDetail): FormState => ({
  title: m.title,
  type: m.type,
  date: m.date,
  start: m.start,
  end: m.end,
  location: m.location ?? '',
  link: m.link ?? '',
  attendees: m.attendees.map((a) => a._id),
  guests: m.guests ?? '',
  agenda: m.agenda ?? '',
  minutes: m.minutes ?? '',
  project: m.project?._id ?? '',
  client: m.client?._id ?? '',
  actions: m.actions.map((a: MeetingAction) => ({ _id: a._id, text: a.text, owner: personId(a.owner), dueDate: a.dueDate ?? '', done: a.done })),
});

/** Schedule a new meeting, or edit one (`editing`). `defaults` pre-fills the date or project for a new one. */
export function MeetingForm({
  open,
  editing,
  defaults,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing?: MeetingDetail | null;
  defaults?: { date?: string; project?: string };
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const opts = useGet<MeetingOptions>(['meetings', 'options'], '/meetings/options', undefined, open);
  const [f, setF] = useState<FormState>(blank());
  useEffect(() => {
    if (!open) return;
    setF(editing ? fromMeeting(editing) : blank(defaults?.date, defaults?.project));
  }, [open, editing, defaults?.date, defaults?.project]);

  const people = opts.data?.people ?? [];
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const setAction = (i: number, patch: Partial<FormState['actions'][number]>) => set('actions', f.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const save = useSend<void, { _id: string }>(editing ? 'put' : 'post', editing ? `/meetings/${editing._id}` : '/meetings', {
    invalidate: [['meetings'], ['notifications']],
    success: editing ? 'Meeting updated' : 'Meeting scheduled',
    onSuccess: (r) => {
      onSaved?.(r._id);
      onClose();
    },
    body: () => ({
      ...f,
      project: f.project || null,
      client: f.client || null,
      actions: f.actions.filter((a) => a.text.trim()).map((a) => ({ ...a, owner: a.owner || null, dueDate: a.dueDate || null })),
    }),
  });

  const timeBad = f.end <= f.start;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit meeting' : 'Schedule a meeting'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Kitchen layout review" />
          </Field>
          <Field label="Type">
            <Select value={f.type} onChange={(e) => set('type', e.target.value)}>
              {MEETING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Start">
            <Input type="time" value={f.start} onChange={(e) => set('start', e.target.value)} />
          </Field>
          <Field label="End" error={timeBad ? 'End must be after the start' : undefined}>
            <Input type="time" value={f.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
          <Field label="Location">
            <Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Office, client site, address…" />
          </Field>
          <Field label="Online link (optional)">
            <Input value={f.link} onChange={(e) => set('link', e.target.value)} placeholder="Meet / Zoom / Teams link" />
          </Field>

          <div className="space-y-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Attendees (from the company)</span>
            <PeoplePicker people={people} value={f.attendees} onChange={(ids) => set('attendees', ids)} label="attendees" />
          </div>
          <Field label="Guests from outside (optional)" className="sm:col-span-2">
            <Input value={f.guests} onChange={(e) => set('guests', e.target.value)} placeholder="Names, company, phone…" />
          </Field>

          <Field label="Project (optional)">
            <Select value={f.project} onChange={(e) => set('project', e.target.value)}>
              <option value="">None</option>
              {opts.data?.projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {opts.data?.canLinkClients && (
            <Field label="Client (optional)">
              <Select value={f.client} onChange={(e) => set('client', e.target.value)}>
                <option value="">None</option>
                {opts.data.clients.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Agenda" className="sm:col-span-2">
            <Textarea rows={3} value={f.agenda} onChange={(e) => set('agenda', e.target.value)} placeholder="What will be discussed" />
          </Field>
          {editing && (
            <Field label="Minutes / notes" className="sm:col-span-2">
              <Textarea rows={4} value={f.minutes} onChange={(e) => set('minutes', e.target.value)} placeholder="What was discussed and decided" />
            </Field>
          )}
        </div>

        <div className="mt-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium">Action items</span>
            <Button type="button" size="sm" variant="outline" onClick={() => set('actions', [...f.actions, { text: '', owner: '', dueDate: '', done: false }])}>
              <Plus /> Add action
            </Button>
          </div>
          {!f.actions.length && <p className="text-xs text-muted-foreground">Follow-ups with an owner and due date, so decisions don't get lost.</p>}
          <div className="space-y-2">
            {f.actions.map((a, i) => (
              <div key={a._id ?? `n${i}`} className="grid items-center gap-2 rounded-md border p-2 sm:grid-cols-[auto_1fr_10rem_9rem_auto]">
                <Checkbox checked={a.done} onChange={(e) => setAction(i, { done: e.target.checked })} aria-label="Done" />
                <Input value={a.text} onChange={(e) => setAction(i, { text: e.target.value })} placeholder="What needs to happen" />
                <Select value={a.owner} onChange={(e) => setAction(i, { owner: e.target.value })}>
                  <option value="">Owner…</option>
                  <PersonOptions people={people} label={(p) => p.name} />
                </Select>
                <Input type="date" value={a.dueDate} onChange={(e) => setAction(i, { dueDate: e.target.value })} />
                <Button type="button" size="icon" variant="ghost" aria-label="Remove action" onClick={() => set('actions', f.actions.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || f.title.trim().length < 2 || timeBad || !f.date} onClick={() => save.mutate(undefined)}>
            {editing ? 'Save changes' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
