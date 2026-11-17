import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Plus, Search, ThumbsUp } from 'lucide-react';
import { useDebounced, useGet, useSend } from '@/api/hooks';
import type { Paged } from '@/api/types';
import { cn } from '@/lib/utils';
import { PageHeader, Pager } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';

export const IDEA_STATUSES = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'declined', label: 'Declined' },
];
export const ideaStatusLabel = (s: string) => IDEA_STATUSES.find((x) => x.value === s)?.label ?? s;

export interface IdeaRow {
  _id: string;
  title: string;
  description: string;
  tags: string[];
  status: string;
  author: { _id: string; name: string };
  votes: number;
  voted: boolean;
  mine: boolean;
  commentCount: number;
  project?: { _id: string; code: string; name: string } | null;
  createdAt: string;
}
type IdeaList = Paged<IdeaRow> & { tags: string[] };

export function IdeaStatusBadge({ status }: { status: string }) {
  const tone = status === 'done' ? 'text-green-700' : status === 'declined' ? 'text-red-700' : status === 'approved' || status === 'in_progress' ? 'text-blue-700' : '';
  return (
    <Badge variant="outline" className={tone}>
      {ideaStatusLabel(status)}
    </Badge>
  );
}

/** The thumbs-up button with its live count. Not available on your own idea or on a closed one. */
export function VoteButton({ idea }: { idea: Pick<IdeaRow, '_id' | 'votes' | 'voted' | 'mine' | 'status'> }) {
  const closed = idea.status === 'done' || idea.status === 'declined';
  const vote = useSend<boolean>('put', `/ideas/${idea._id}/vote`, { invalidate: [['ideas']], body: (voted) => ({ voted }) });
  return (
    <Button
      variant={idea.voted ? 'default' : 'outline'}
      size="sm"
      aria-pressed={idea.voted}
      aria-label={`${idea.voted ? 'Remove your vote' : 'Vote'}, ${idea.votes} vote${idea.votes === 1 ? '' : 's'}`}
      disabled={idea.mine || closed || vote.isPending}
      title={idea.mine ? 'You cannot vote for your own idea' : closed ? 'Voting is closed' : undefined}
      onClick={() => vote.mutate(!idea.voted)}
    >
      <ThumbsUp /> {idea.votes}
    </Button>
  );
}

export function IdeasPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', status: '', tag: '', sort: 'votes', mine: '' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(f.q);
  const { data } = useGet<IdeaList>(['ideas', 'list'], '/ideas', { q: dq || undefined, status: f.status || undefined, tag: f.tag || undefined, sort: f.sort, mine: f.mine || undefined, page, limit: 20 });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: e.target.value });
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title="Innovation hub"
        description="Share an idea, back the ones you like, and see what happens to them."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> New idea
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search ideas" aria-label="Search ideas" value={f.q} onChange={set('q')} />
        </div>
        <Select className="w-40" aria-label="Stage" value={f.status} onChange={set('status')}>
          <option value="">All stages</option>
          {IDEA_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select className="w-36" aria-label="Tag" value={f.tag} onChange={set('tag')}>
          <option value="">All tags</option>
          {data?.tags.map((t) => <option key={t}>{t}</option>)}
        </Select>
        <Select className="w-36" aria-label="Sort" value={f.sort} onChange={set('sort')}>
          <option value="votes">Most votes</option>
          <option value="new">Newest</option>
        </Select>
        <Select className="w-36" aria-label="Whose" value={f.mine} onChange={set('mine')}>
          <option value="">Everyone's</option>
          <option value="true">Mine</option>
        </Select>
      </div>
      <div className="space-y-3">
        {!data?.items.length && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">{data ? 'No ideas match.' : 'Loading…'}</CardContent>
          </Card>
        )}
        {data?.items.map((i) => (
          <Card key={i._id} className={cn('transition-colors hover:border-primary')}>
            <CardContent className="flex items-start gap-4 py-4">
              <VoteButton idea={i} />
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => nav(`/ideas/${i._id}`)}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/ideas/${i._id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {i.title}
                  </Link>
                  <IdeaStatusBadge status={i.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{i.description}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{i.author?.name}</span>
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> {i.commentCount}
                  </span>
                  {i.tags.map((t) => (
                    <span key={t} className="rounded bg-muted px-1.5 py-0.5">
                      {t}
                    </span>
                  ))}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {data && <Pager page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
      <IdeaForm open={adding} onClose={() => setAdding(false)} onSaved={(id) => nav(`/ideas/${id}`)} />
    </>
  );
}

export function IdeaForm({ open, idea, onClose, onSaved }: { open: boolean; idea?: { _id: string; title: string; description: string; tags: string[] } | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const [f, setF] = useState({ title: '', description: '', tags: '' });
  useEffect(() => {
    if (open) setF(idea ? { title: idea.title, description: idea.description, tags: idea.tags.join(', ') } : { title: '', description: '', tags: '' });
  }, [open, idea]);
  const save = useSend<void, { _id: string }>(idea ? 'put' : 'post', idea ? `/ideas/${idea._id}` : '/ideas', {
    invalidate: [['ideas']],
    success: idea ? 'Idea updated' : 'Idea shared',
    body: () => ({ title: f.title, description: f.description, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) }),
    onSuccess: (r) => {
      onClose();
      onSaved?.(r._id);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{idea ? 'Edit idea' : 'Share an idea'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Title">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Describe it">
            <Textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <Field label="Tags (comma separated, up to 6)">
            <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || f.title.trim().length < 4 || f.description.trim().length < 10} onClick={() => save.mutate(undefined)}>
            {idea ? 'Save' : 'Share idea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
