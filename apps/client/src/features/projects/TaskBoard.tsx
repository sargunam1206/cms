import { useState } from 'react';
import dayjs from 'dayjs';
import { Plus } from 'lucide-react';
import { useSend } from '@/api/hooks';
import { useAuth } from '@/lib/auth';
import { cn, fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PriorityBadge } from './TaskDialogs';
import { TASK_STATUSES, isOverdue, type TaskRow, type TaskStatus } from './types';

const initials = (name?: string) => (name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

/** Kanban board. Cards can be dragged by the assignee or a project manager; dropping on a card puts it above that card. */
export function TaskBoard({ tasks, canManage, onOpen, onAdd }: { tasks: TaskRow[]; canManage: boolean; onOpen: (t: TaskRow) => void; onAdd: (status: TaskStatus) => void }) {
  const { user } = useAuth();
  const me = user?.employee?._id;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const today = dayjs().format('YYYY-MM-DD');
  const move = useSend<{ id: string; status: TaskStatus; position?: number }>('post', (v) => `/projects/tasks/${v.id}/status`, {
    invalidate: [['projects']],
    body: (v) => ({ status: v.status, position: v.position }),
  });
  const mayMove = (t: TaskRow) => canManage || (!!me && t.assignee?._id === me);

  const drop = (status: TaskStatus, position?: number) => {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;
    const t = tasks.find((x) => x._id === id);
    if (t && mayMove(t)) move.mutate({ id, status, position });
  };

  return (
    <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-5" role="list" aria-label="Task board">
      {TASK_STATUSES.map((col) => {
        const items = tasks.filter((t) => t.status === col.value).sort((a, b) => a.position - b.position);
        return (
          <section
            key={col.value}
            className={cn('flex min-h-[200px] min-w-[220px] flex-col gap-2 rounded-lg border bg-muted/30 p-2', over === col.value && 'ring-2 ring-primary')}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.value);
            }}
            onDragLeave={() => setOver((o) => (o === col.value ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              drop(col.value);
            }}
            aria-label={`${col.label} column`}
          >
            <header className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold">
                {col.label} <span className="ml-1 text-xs font-normal text-muted-foreground">{items.length}</span>
              </h3>
              {canManage && (
                <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Add task to ${col.label}`} onClick={() => onAdd(col.value)}>
                  <Plus />
                </Button>
              )}
            </header>
            {items.map((t, i) => (
              <article
                key={t._id}
                role="listitem"
                draggable={mayMove(t)}
                onDragStart={() => setDragging(t._id)}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drop(col.value, i);
                }}
                onClick={() => onOpen(t)}
                className={cn('cursor-pointer rounded-md border bg-background p-2 text-sm shadow-sm hover:border-primary', dragging === t._id && 'opacity-50', mayMove(t) && 'cursor-grab')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{t.ref}</span>
                  <PriorityBadge priority={t.priority} />
                </div>
                <div className="mt-1 font-medium leading-snug">{t.title}</div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span className={cn(isOverdue(t, today) && 'font-medium text-red-700')}>{t.dueDate ? fmtDate(t.dueDate) : ''}</span>
                  {t.assignee ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" title={t.assignee.name}>
                      {initials(t.assignee.name)}
                    </span>
                  ) : (
                    <span>Unassigned</span>
                  )}
                </div>
              </article>
            ))}
            {!items.length && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here</p>}
          </section>
        );
      })}
    </div>
  );
}
