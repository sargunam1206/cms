import { useEffect, useMemo, useState } from 'react';
import { GitCompare, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { cn, fmtDate } from '@/lib/utils';
import { Spinner, Stat } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { inr } from '@/features/payroll/types';

export type EstimateStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'superseded';
interface Line {
  _id?: string;
  module: string;
  task: string;
  role: string;
  hours: number;
  note?: string;
  costRate?: number;
  billingRate?: number;
}
interface Summary {
  _id: string;
  version: number;
  status: EstimateStatus;
  totalHours: number;
  totalCost?: number;
  totalBilling?: number;
  lineCount: number;
  submittedAt?: string;
  decidedAt?: string;
}
interface Detail extends Summary {
  note?: string;
  lines: Line[];
  decisionComment?: string;
  submittedBy?: string;
  canEdit: boolean;
  canSeeMoney: boolean;
}
interface List {
  canEdit: boolean;
  canSeeMoney: boolean;
  items: Summary[];
}
interface Diff {
  from: Summary;
  to: Summary;
  added: Line[];
  removed: Line[];
  changed: (Line & { before: number })[];
}

export const ESTIMATE_LABEL: Record<EstimateStatus, string> = { draft: 'Draft', submitted: 'Waiting for approval', approved: 'Approved', rejected: 'Sent back', superseded: 'Replaced by a newer version' };
const TONE: Record<EstimateStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = { draft: 'outline', submitted: 'secondary', approved: 'default', rejected: 'destructive', superseded: 'outline' };
const h = (n: number) => `${Math.round(n * 100) / 100} h`;

export function EstimateTab({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const list = useGet<List>(['estimates', 'list', projectId], `/estimates/project/${projectId}`);
  const [picked, setPicked] = useState<string>('');
  const current = picked && list.data?.items.some((i) => i._id === picked) ? picked : list.data?.items[0]?._id;
  const detail = useGet<Detail>(['estimates', 'detail', current], `/estimates/${current}`, undefined, !!current);
  const create = useSend<{ copyFrom?: string }, Summary>('post', `/estimates/project/${projectId}`, { invalidate: [['estimates']], onSuccess: (e) => setPicked(e._id), success: 'New version started' });

  if (list.isLoading || !list.data) return <Spinner />;
  const open = list.data.items.find((i) => ['draft', 'submitted', 'rejected'].includes(i.status));
  const latestApproved = list.data.items.find((i) => i.status === 'approved');

  if (!list.data.items.length)
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <p>No estimate has been approved for this project yet.</p>
          {list.data.canEdit && (
            <Button className="mt-4" disabled={create.isPending} onClick={() => create.mutate({})}>
              <Plus /> Start an estimate
            </Button>
          )}
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-72" value={current} onChange={(e) => setPicked(e.target.value)} aria-label="Version">
          {list.data.items.map((i) => (
            <option key={i._id} value={i._id}>
              {`v${i.version} · ${ESTIMATE_LABEL[i.status]} · ${h(i.totalHours)}`}
            </option>
          ))}
        </Select>
        {list.data.canEdit && !open && (
          <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate({ copyFrom: latestApproved?._id ?? current })}>
            <Plus /> New version
          </Button>
        )}
      </div>
      {detail.data ? <EstimateBody key={detail.data._id} e={detail.data} canDecide={can(P.ESTIMATES_APPROVE)} /> : <Spinner />}
    </div>
  );
}

function EstimateBody({ e, canDecide }: { e: Detail; canDecide: boolean }) {
  const editable = e.canEdit && (e.status === 'draft' || e.status === 'rejected');
  const roles = useGet<string[]>(['estimates', 'roles'], '/estimates/roles', undefined, editable);
  const [lines, setLines] = useState<Line[]>(e.lines);
  const [note, setNote] = useState(e.note ?? '');
  const [dirty, setDirty] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [sendBack, setSendBack] = useState(false);
  useEffect(() => {
    setLines(e.lines);
    setNote(e.note ?? '');
    setDirty(false);
  }, [e]);

  const inv = [['estimates'], ['projects']];
  const save = useSend<void>('put', `/estimates/${e._id}`, { invalidate: inv, success: 'Estimate saved', body: () => ({ note, lines: lines.map((l) => ({ module: l.module, task: l.task, role: l.role, hours: Number(l.hours), note: l.note })) }) });
  const submit = useSend<void>('post', `/estimates/${e._id}/submit`, { invalidate: inv, success: 'Submitted for approval', body: () => ({}) });
  const discard = useSend<void>('delete', `/estimates/${e._id}`, { invalidate: inv, success: 'Draft discarded' });
  const decide = useSend<{ decision: 'approved' | 'rejected'; comment?: string }>('post', `/estimates/${e._id}/decision`, { invalidate: inv, onSuccess: () => setSendBack(false) });

  const set = (i: number, patch: Partial<Line>) => {
    setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const totalHours = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const modules = useMemo(() => [...new Set(lines.map((l) => l.module).filter(Boolean))], [lines]);
  const money = e.canSeeMoney;
  const cost = e.totalCost ?? 0;
  const billing = e.totalBilling ?? 0;
  const incomplete = lines.some((l) => !l.module.trim() || !l.task.trim() || !l.role || !(Number(l.hours) >= 0.25));

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={TONE[e.status]}>{ESTIMATE_LABEL[e.status]}</Badge>
        {e.decidedAt && <span className="text-xs text-muted-foreground">{fmtDate(e.decidedAt)}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {e.version > 1 && (
            <Button variant="outline" onClick={() => setShowDiff(!showDiff)}>
              <GitCompare /> {showDiff ? 'Hide changes' : 'What changed'}
            </Button>
          )}
          {editable && (
            <>
              <Button variant="outline" disabled={discard.isPending} onClick={() => confirm('Discard this draft?') && discard.mutate(undefined)}>
                <Trash2 /> Discard
              </Button>
              <Button variant="outline" disabled={!dirty || incomplete || save.isPending} onClick={() => save.mutate(undefined)}>
                Save
              </Button>
              <Button disabled={dirty || !lines.length || submit.isPending} title={dirty ? 'Save your changes first' : undefined} onClick={() => submit.mutate(undefined)}>
                Submit for approval
              </Button>
            </>
          )}
          {e.status === 'submitted' && canDecide && (
            <>
              <Button variant="outline" onClick={() => setSendBack(true)}>
                Send back
              </Button>
              <Button disabled={decide.isPending} onClick={() => decide.mutate({ decision: 'approved' })}>
                Approve
              </Button>
            </>
          )}
        </div>
      </div>

      {e.status === 'rejected' && e.decisionComment && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Sent back: {e.decisionComment}</p>}

      <div className={cn('grid gap-3 sm:grid-cols-2', money ? 'lg:grid-cols-4' : 'lg:grid-cols-2')}>
        <Stat label="Hours" value={h(editable ? totalHours : e.totalHours)} />
        <Stat label="Lines" value={editable ? lines.length : e.lineCount} />
        {money && <Stat label="Cost" value={inr(cost)} />}
        {money && <Stat label="Billing" value={inr(billing)} tone={billing >= cost ? 'good' : 'bad'} />}
      </div>

      {showDiff && <DiffPanel id={e._id} money={money} />}

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Module</TH>
                <TH>Task</TH>
                <TH>Role</TH>
                <TH className="text-right">Hours</TH>
                {money && <TH className="text-right">Cost</TH>}
                {editable && <TH className="w-10" />}
              </TR>
            </THead>
            <TBody>
              {!lines.length && <EmptyRow cols={money ? 6 : 5} text="No lines yet. Add what the project needs, by module and role." />}
              {lines.map((l, i) =>
                editable ? (
                  <TR key={i}>
                    <TD>
                      <Input list={`mods-${e._id}`} aria-label={`Module, line ${i + 1}`} value={l.module} onChange={(ev) => set(i, { module: ev.target.value })} />
                    </TD>
                    <TD>
                      <Input aria-label={`Task, line ${i + 1}`} value={l.task} onChange={(ev) => set(i, { task: ev.target.value })} />
                    </TD>
                    <TD>
                      <Select aria-label={`Role, line ${i + 1}`} value={l.role} onChange={(ev) => set(i, { role: ev.target.value })}>
                        <option value="">Choose…</option>
                        {(roles.data ?? [l.role]).filter(Boolean).map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </Select>
                    </TD>
                    <TD className="text-right">
                      <Input className="w-24 text-right" type="number" min={0.25} step={0.25} aria-label={`Hours, line ${i + 1}`} value={l.hours} onChange={(ev) => set(i, { hours: ev.target.value as unknown as number })} />
                    </TD>
                    {money && <TD className="text-right tabular-nums text-muted-foreground">{l.costRate != null ? inr(Math.round((Number(l.hours) || 0) * l.costRate)) : '—'}</TD>}
                    <TD>
                      <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => { setLines(lines.filter((_, k) => k !== i)); setDirty(true); }}>
                        <Trash2 />
                      </Button>
                    </TD>
                  </TR>
                ) : (
                  <TR key={i}>
                    <TD className="font-medium">{l.module}</TD>
                    <TD>{l.task}</TD>
                    <TD>{l.role}</TD>
                    <TD className="text-right tabular-nums">{h(l.hours)}</TD>
                    {money && <TD className="text-right tabular-nums">{inr(Math.round(l.hours * (l.costRate ?? 0)))}</TD>}
                  </TR>
                ),
              )}
            </TBody>
          </Table>
          <datalist id={`mods-${e._id}`}>
            {modules.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </CardContent>
      </Card>

      {editable && (
        <div className="space-y-3">
          <Button variant="outline" onClick={() => { setLines([...lines, { module: lines.at(-1)?.module ?? '', task: '', role: '', hours: 1 }]); setDirty(true); }}>
            <Plus /> Add line
          </Button>
          <Field label="Note for the approver">
            <Textarea rows={2} className="max-w-2xl" value={note} onChange={(ev) => { setNote(ev.target.value); setDirty(true); }} />
          </Field>
          {incomplete && lines.length > 0 && <p className="text-xs text-amber-700">Every line needs a module, a task, a role and at least 0.25 hours before it can be saved.</p>}
        </div>
      )}
      {!editable && e.note && <p className="max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">{e.note}</p>}
      <ModuleTotals lines={editable ? lines : e.lines} money={money} />

      <Dialog open={sendBack} onOpenChange={setSendBack}>
        <SendBack busy={decide.isPending} onSend={(comment) => decide.mutate({ decision: 'rejected', comment })} />
      </Dialog>
    </>
  );
}

function ModuleTotals({ lines, money }: { lines: Line[]; money: boolean }) {
  const by = new Map<string, { hours: number; cost: number }>();
  for (const l of lines) {
    const k = l.module || '—';
    const cur = by.get(k) ?? { hours: 0, cost: 0 };
    cur.hours += Number(l.hours) || 0;
    cur.cost += (Number(l.hours) || 0) * (l.costRate ?? 0);
    by.set(k, cur);
  }
  if (by.size < 2) return null;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <THead>
            <TR>
              <TH>By module</TH>
              <TH className="text-right">Hours</TH>
              {money && <TH className="text-right">Cost</TH>}
            </TR>
          </THead>
          <TBody>
            {[...by].map(([m, v]) => (
              <TR key={m}>
                <TD>{m}</TD>
                <TD className="text-right tabular-nums">{h(v.hours)}</TD>
                {money && <TD className="text-right tabular-nums">{inr(Math.round(v.cost))}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function DiffPanel({ id, money }: { id: string; money: boolean }) {
  const { data } = useGet<Diff>(['estimates', 'diff', id], `/estimates/${id}/compare`);
  if (!data) return <Spinner />;
  const none = !data.added.length && !data.removed.length && !data.changed.length;
  return (
    <Card>
      <CardContent className="space-y-2 pt-4 text-sm">
        <p className="font-medium">
          v{data.from.version} → v{data.to.version}: {h(data.to.totalHours - data.from.totalHours)} {money && data.to.totalCost != null && data.from.totalCost != null && `· ${inr(data.to.totalCost - data.from.totalCost)}`}
        </p>
        {none && <p className="text-muted-foreground">No differences in the lines.</p>}
        {data.added.map((l, i) => (
          <p key={`a${i}`} className="text-green-700">+ {l.module} / {l.task} ({l.role}) {h(l.hours)}</p>
        ))}
        {data.removed.map((l, i) => (
          <p key={`r${i}`} className="text-red-700">− {l.module} / {l.task} ({l.role}) {h(l.hours)}</p>
        ))}
        {data.changed.map((l, i) => (
          <p key={`c${i}`} className="text-amber-700">~ {l.module} / {l.task} ({l.role}) {h(l.before)} → {h(l.hours)}</p>
        ))}
      </CardContent>
    </Card>
  );
}

function SendBack({ onSend, busy }: { onSend: (comment: string) => void; busy: boolean }) {
  const [comment, setComment] = useState('');
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Send the estimate back</DialogTitle>
      </DialogHeader>
      <Field label="What needs to change">
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button disabled={!comment.trim() || busy} onClick={() => onSend(comment.trim())}>
          Send back
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
