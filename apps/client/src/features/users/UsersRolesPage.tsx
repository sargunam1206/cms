import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { PERMISSIONS as P, type Permission } from '@cms/shared';
import { useDebounced, useGet, useSend } from '@/api/hooks';
import type { Employee, Paged, Role, UserRow } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Pager } from '@/components/common/page';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function UsersRolesPage() {
  const { can } = useAuth();
  return (
    <>
      <PageHeader title="Users & Roles" />
      <Tabs defaultValue={can(P.USERS_MANAGE) ? 'users' : 'roles'}>
        <TabsList>
          {can(P.USERS_MANAGE) && <TabsTrigger value="users">Users</TabsTrigger>}
          {can(P.ROLES_MANAGE) && <TabsTrigger value="roles">Roles & permissions</TabsTrigger>}
        </TabsList>
        {can(P.USERS_MANAGE) && (
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
        )}
        {can(P.ROLES_MANAGE) && (
          <TabsContent value="roles">
            <RolesTab />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

interface RolesResponse {
  roles: Role[];
  allPermissions: Permission[];
}

function UsersTab() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const users = useGet<Paged<UserRow>>(['users'], '/users', { q: dq || undefined, page, limit: 50 });
  const roles = useGet<RolesResponse>(['roles'], '/roles');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);

  return (
    <>
      <div className="mb-3 flex justify-between gap-2">
        <Input className="w-64" placeholder="Search email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Button onClick={() => setEditing('new')}>
          <Plus /> New login
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Employee</TH>
                <TH>Last login</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {!users.data?.items.length && <EmptyRow cols={6} />}
              {users.data?.items.map((u) => (
                <TR key={u._id}>
                  <TD className="font-medium">{u.email}</TD>
                  <TD>{u.role?.name}</TD>
                  <TD>{u.employee ? `${u.employee.name} (${u.employee.code})` : '—'}</TD>
                  <TD>{fmtDate(u.lastLoginAt)}</TD>
                  <TD>
                    <StatusBadge status={u.status} />
                  </TD>
                  <TD className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Edit
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      {users.data && <Pager page={users.data.page} limit={users.data.limit} total={users.data.total} onPage={setPage} />}
      <UserDialog editing={editing} roles={roles.data?.roles ?? []} onClose={() => setEditing(null)} />
    </>
  );
}

function UserDialog({ editing, roles, onClose }: { editing: UserRow | 'new' | null; roles: Role[]; onClose: () => void }) {
  const isNew = editing === 'new';
  const emps = useGet<Paged<Employee>>(['employees', 'all'], '/employees', { limit: 500, status: 'active' }, !!editing);
  const [form, setForm] = useState({ email: '', password: '', role: '', employee: '', status: 'active' });
  useEffect(() => {
    if (editing === 'new') setForm({ email: '', password: '', role: roles.find((r) => r.name === 'Employee')?._id ?? '', employee: '', status: 'active' });
    else if (editing) setForm({ email: editing.email, password: '', role: editing.role?._id, employee: editing.employee?._id ?? '', status: editing.status });
  }, [editing, roles]);

  const save = useSend(isNew ? 'post' : 'patch', isNew ? '/users' : `/users/${editing?._id ?? ''}`, {
    invalidate: [['users']],
    success: 'Saved',
    onSuccess: onClose,
    body: () =>
      isNew
        ? { email: form.email, password: form.password, role: form.role, employee: form.employee || undefined }
        : { role: form.role, employee: form.employee || null, status: form.status, password: form.password || undefined },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? 'New login' : `Edit ${form.email}`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isNew && (
            <Field label="Email">
              <Input type="email" value={form.email} onChange={set('email')} />
            </Field>
          )}
          <Field label={isNew ? 'Password' : 'Reset password (leave blank to keep)'}>
            <Input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={set('role')}>
              {roles.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Linked employee">
            <Select value={form.employee} onChange={set('employee')}>
              <option value="">— none —</option>
              {emps.data?.items.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </Select>
          </Field>
          {!isNew && (
            <Field label="Status">
              <Select value={form.status} onChange={set('status')}>
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </Select>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RolesTab() {
  const { data } = useGet<RolesResponse>(['roles'], '/roles');
  const [draft, setDraft] = useState<Record<string, Set<Permission>>>({});
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (data) setDraft(Object.fromEntries(data.roles.map((r) => [r._id, new Set(r.permissions)])));
  }, [data]);

  const save = useSend<Role>('put', (r) => `/roles/${r._id}`, {
    invalidate: [['roles']],
    success: 'Role saved',
    body: (r) => ({ name: r.name, permissions: [...draft[r._id]] }),
  });
  const create = useSend('post', '/roles', {
    invalidate: [['roles']],
    success: 'Role created',
    body: () => ({ name: newName, permissions: [] }),
    onSuccess: () => setNewName(''),
  });
  const remove = useSend<string>('delete', (id) => `/roles/${id}`, { invalidate: [['roles']], success: 'Role deleted' });

  const toggle = (roleId: string, p: Permission) =>
    setDraft((d) => {
      const s = new Set(d[roleId]);
      if (s.has(p)) s.delete(p);
      else s.add(p);
      return { ...d, [roleId]: s };
    });

  if (!data) return null;
  const groups = Object.entries(
    data.allPermissions.reduce<Record<string, Permission[]>>((acc, p) => {
      (acc[p.split('.')[0]] ??= []).push(p);
      return acc;
    }, {}),
  );

  return (
    <>
      <div className="mb-3 flex justify-end gap-2">
        <Input className="w-48" placeholder="New role name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button variant="outline" disabled={newName.trim().length < 2} onClick={() => create.mutate(undefined)}>
          <Plus /> Add role
        </Button>
      </div>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <THead>
              <TR>
                <TH>Permission</TH>
                {data.roles.map((r) => (
                  <TH key={r._id} className="text-center">
                    {r.name}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {groups.map(([group, perms]) =>
                perms.map((p, i) => (
                  <TR key={p}>
                    <TD>
                      {i === 0 && <div className="text-xs font-semibold uppercase text-muted-foreground">{group}</div>}
                      <span className="font-mono text-xs">{p}</span>
                    </TD>
                    {data.roles.map((r) => (
                      <TD key={r._id} className="text-center">
                        <Checkbox checked={draft[r._id]?.has(p) ?? false} onChange={() => toggle(r._id, p)} />
                      </TD>
                    ))}
                  </TR>
                )),
              )}
              <TR>
                <TD />
                {data.roles.map((r) => (
                  <TD key={r._id} className="space-y-1 text-center">
                    <Button size="sm" onClick={() => save.mutate(r)} disabled={save.isPending}>
                      Save
                    </Button>
                    {!r.system && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove.mutate(r._id)}>
                        Delete
                      </Button>
                    )}
                  </TD>
                ))}
              </TR>
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
