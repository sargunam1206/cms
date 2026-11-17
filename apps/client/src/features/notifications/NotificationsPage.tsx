import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useGet, useSend } from '@/api/hooks';
import { cn } from '@/lib/utils';
import { PageHeader, Pager } from '@/components/common/page';
import type { Note } from '@/components/common/NotificationBell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox, Select } from '@/components/ui/form-controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Page {
  items: Note[];
  total: number;
  page: number;
  limit: number;
  unread: number;
}
interface Kind {
  key: string;
  label: string;
  email: boolean;
}
interface Prefs {
  emailMuted: string[];
  inAppMuted: string[];
}

export function NotificationsPage() {
  const nav = useNavigate();
  const [only, setOnly] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useGet<Page>(['notifications', 'all'], '/notifications', { unread: only || undefined, page, limit: 20 });
  const read = useSend<string>('post', (id) => `/notifications/${id}/read`, { invalidate: [['notifications']], body: () => ({}) });
  const readAll = useSend<void>('post', '/notifications/read-all', { invalidate: [['notifications']], success: 'All marked read', body: () => ({}) });

  return (
    <>
      <PageHeader
        title="Notifications"
        description={data ? `${data.unread} unread` : undefined}
        actions={
          <>
            <Select className="w-36" value={only} onChange={(e) => { setOnly(e.target.value); setPage(1); }} aria-label="Show">
              <option value="">All</option>
              <option value="true">Unread only</option>
            </Select>
            <Button variant="outline" disabled={!data?.unread} onClick={() => readAll.mutate(undefined)}>
              Mark all read
            </Button>
          </>
        }
      />
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Inbox</TabsTrigger>
          <TabsTrigger value="prefs">Preferences</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Card>
            <CardContent className="p-0">
              {!data?.items.length && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing here</p>}
              <ul>
                {data?.items.map((n) => (
                  <li key={n._id} className="border-b last:border-0">
                    <button
                      type="button"
                      className={cn('flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-accent', !n.readAt && 'bg-primary/5')}
                      onClick={() => {
                        if (!n.readAt) read.mutate(n._id);
                        if (n.link) nav(n.link);
                      }}
                    >
                      <span>
                        <span className={cn('block text-sm', !n.readAt && 'font-semibold')}>{n.title}</span>
                        {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{dayjs(n.createdAt).format('DD MMM, hh:mm A')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
        </TabsContent>
        <TabsContent value="prefs">
          <Preferences />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Preferences() {
  const kinds = useGet<Kind[]>(['notifications', 'types'], '/notifications/types');
  const prefs = useGet<Prefs>(['notifications', 'prefs'], '/notifications/prefs');
  // Shown immediately on click and then saved; if saving fails the server's version comes back
  const [local, setLocal] = useState<Prefs | null>(null);
  useEffect(() => {
    if (prefs.data) setLocal(prefs.data);
  }, [prefs.data]);
  const save = useSend<Prefs>('put', '/notifications/prefs', {
    invalidate: [['notifications', 'prefs']],
    success: 'Preferences saved',
    body: (v) => v,
  });
  if (!kinds.data || !local) return null;
  const toggle = (list: 'emailMuted' | 'inAppMuted', key: string, on: boolean) => {
    const next = { ...local, [list]: on ? local[list].filter((k) => k !== key) : [...local[list], key] };
    setLocal(next);
    save.mutate(next, { onError: () => prefs.refetch().then((r) => r.data && setLocal(r.data)) });
  };
  const p = local;
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-4 py-2 font-medium">Tell me when…</th>
              <th className="w-24 px-2 py-2 text-center font-medium">In the bell</th>
              <th className="w-24 px-2 py-2 text-center font-medium">By email</th>
            </tr>
          </thead>
          <tbody>
            {kinds.data.map((k) => (
              <tr key={k.key} className="border-b last:border-0">
                <td className="px-4 py-2">{k.label}</td>
                <td className="px-2 py-2 text-center">
                  <Checkbox aria-label={`${k.label}: in the bell`} checked={!p.inAppMuted.includes(k.key)} onChange={(e) => toggle('inAppMuted', k.key, e.target.checked)} />
                </td>
                <td className="px-2 py-2 text-center">
                  {k.email ? (
                    <Checkbox aria-label={`${k.label}: by email`} checked={!p.emailMuted.includes(k.key)} onChange={(e) => toggle('emailMuted', k.key, e.target.checked)} />
                  ) : (
                    <span className="text-xs text-muted-foreground">never</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
