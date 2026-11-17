import { useEffect, useRef, useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Bell } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useGet, useSend } from '@/api/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

dayjs.extend(relativeTime);

export interface Note {
  _id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  readAt?: string | null;
  createdAt: string;
}
interface List {
  items: Note[];
  unread: number;
  total: number;
}

/** The bell: a count of unread items and the latest few. Updated live, and every minute as a fallback. */
export function NotificationBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The panel is placed from the bell's position and kept inside the window, wherever the bell is (sidebar or top bar)
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({ left: 8, top: 56, width: 320 });
  const place = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(360, window.innerWidth - 16);
    setPos({ width, top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
  };
  const { data } = useGet<List>(['notifications', 'bell'], '/notifications', { limit: 8 });
  const count = useGet<{ unread: number }>(['notifications', 'count'], '/notifications/unread-count');
  // poll as a safety net in case the live connection is down
  useEffect(() => {
    const t = setInterval(() => {
      count.refetch();
      if (open) void 0;
    }, 60_000);
    return () => clearInterval(t);
  }, [count, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  const read = useSend<string>('post', (id) => `/notifications/${id}/read`, { invalidate: [['notifications']], body: () => ({}) });
  const readAll = useSend<void>('post', '/notifications/read-all', { invalidate: [['notifications']], body: () => ({}) });
  const unread = count.data?.unread ?? data?.unread ?? 0;

  return (
    <div ref={box} className="relative">
      <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open} onClick={() => { place(); setOpen(!open); }} className="relative">
        <Bell />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white" data-testid="bell-count">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="fixed z-50 rounded-lg border bg-background shadow-lg" style={{ left: pos.left, top: pos.top, width: pos.width }}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <Button size="sm" variant="ghost" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate(undefined)}>
              Mark all read
            </Button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!data?.items.length && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing yet</li>}
            {data?.items.map((n) => (
              <li key={n._id}>
                <button
                  type="button"
                  className={cn('flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-sm hover:bg-accent', !n.readAt && 'bg-primary/5')}
                  onClick={() => {
                    if (!n.readAt) read.mutate(n._id);
                    setOpen(false);
                    if (n.link) nav(n.link);
                  }}
                >
                  <span className={cn(!n.readAt && 'font-semibold')}>{n.title}</span>
                  {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                  <span className="text-xs text-muted-foreground">{dayjs(n.createdAt).fromNow()}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="px-3 py-2 text-right">
            <Link to="/notifications" className="text-sm text-primary hover:underline" onClick={() => setOpen(false)}>
              See all and preferences
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
