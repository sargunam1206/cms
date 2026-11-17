import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useGet, useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import type { ClientRow } from './types';

const BLANK = { name: '', contactName: '', email: '', phone: '', address: '', gstin: '', notes: '', active: true };

export function ClientsPage() {
  const { can } = useAuth();
  const { data } = useGet<ClientRow[]>(['projects', 'clients'], '/projects/clients');
  const [editing, setEditing] = useState<ClientRow | 'new' | null>(null);
  const canEdit = can(P.PROJECTS_MANAGE);
  return (
    <>
      <PageHeader
        title="Clients"
        description="Companies you do project work for"
        actions={canEdit && <Button onClick={() => setEditing('new')}><Plus /> Add client</Button>}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Contact</TH>
                <TH>Email</TH>
                <TH>GSTIN</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!data?.length && <EmptyRow cols={6} text="No clients yet" />}
              {data?.map((c) => (
                <TR key={c._id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD>{c.contactName}</TD>
                  <TD>{c.email}</TD>
                  <TD className="font-mono text-xs">{c.gstin}</TD>
                  <TD>{c.active ? <Badge variant="success">active</Badge> : <Badge variant="secondary">inactive</Badge>}</TD>
                  <TD className="text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
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
      <ClientDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function ClientDialog({ editing, onClose }: { editing: ClientRow | 'new' | null; onClose: () => void }) {
  const existing = typeof editing === 'object' && editing ? editing : null;
  const [f, setF] = useState(BLANK);
  useEffect(() => {
    if (editing === 'new') setF(BLANK);
    else if (existing) setF({ ...BLANK, ...existing, contactName: existing.contactName ?? '', email: existing.email ?? '', phone: existing.phone ?? '', address: existing.address ?? '', gstin: existing.gstin ?? '', notes: existing.notes ?? '' });
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSend(existing ? 'put' : 'post', existing ? `/projects/clients/${existing._id}` : '/projects/clients', {
    invalidate: [['projects']],
    success: 'Client saved',
    onSuccess: onClose,
    body: () => f,
  });
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit client' : 'Add client'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" className="sm:col-span-2">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Contact person">
            <Input value={f.contactName} onChange={set('contactName')} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="GSTIN">
            <Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea rows={2} value={f.address} onChange={set('address')} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea rows={2} value={f.notes} onChange={set('notes')} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
          </label>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || f.name.trim().length < 2} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
