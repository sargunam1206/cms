import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useGet, useSend } from '@/api/hooks';
import { PageHeader, Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form-controls';
import { IDEA_STATUSES, IdeaForm, IdeaStatusBadge, VoteButton, ideaStatusLabel, type IdeaRow } from './IdeasPage';

interface Comment {
  _id: string;
  byName: string;
  text: string;
  at: string;
  replyTo?: string | null;
}
interface Detail extends IdeaRow {
  comments: Comment[];
  history: { at: string; byName?: string; from?: string; to: string; comment?: string }[];
  canManage: boolean;
  canEdit: boolean;
}

export function IdeaPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: i, isError } = useGet<Detail>(['ideas', 'detail', id], `/ideas/${id}`);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const comment = useSend<void>('post', `/ideas/${id}/comments`, {
    invalidate: [['ideas']],
    body: () => ({ text, ...(replyTo ? { parent: replyTo } : {}) }),
    onSuccess: () => {
      setText('');
      setReplyTo(null);
    },
  });
  const del = useSend<void>('delete', `/ideas/${id}`, { invalidate: [['ideas']], success: 'Idea removed', onSuccess: () => nav('/ideas') });

  if (isError)
    return (
      <div className="py-20 text-center text-muted-foreground">
        This idea does not exist.{' '}
        <Link to="/ideas" className="text-primary underline">
          Back to ideas
        </Link>
      </div>
    );
  if (!i) return <Spinner />;
  const top = i.comments.filter((c) => !c.replyTo);
  const replies = (c: Comment) => i.comments.filter((r) => r.replyTo === c._id);

  return (
    <>
      <Link to="/ideas" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All ideas
      </Link>
      <PageHeader
        title={i.title}
        description={`${i.author?.name} · ${dayjs(i.createdAt).format('DD MMM YYYY')}`}
        actions={
          <>
            <IdeaStatusBadge status={i.status} />
            <VoteButton idea={i} />
            {i.canEdit && (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {i.canManage && (
              <Button variant="outline" onClick={() => setMoving(true)}>
                Change stage
              </Button>
            )}
            {(i.canManage || (i.mine && i.status === 'submitted' && i.votes === 0)) && (
              <Button variant="ghost" size="icon" aria-label="Remove idea" onClick={() => confirm('Remove this idea?') && del.mutate(undefined)}>
                <Trash2 />
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <p className="whitespace-pre-wrap text-sm">{i.description}</p>
              {i.tags.length > 0 && (
                <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {i.tags.map((t) => (
                    <span key={t} className="rounded bg-muted px-1.5 py-0.5">
                      {t}
                    </span>
                  ))}
                </p>
              )}
              {i.project && (
                <p className="text-sm">
                  Project:{' '}
                  <Link className="text-primary underline" to={`/projects/${i.project._id}`}>
                    {i.project.code} {i.project.name}
                  </Link>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comments ({i.comments.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!top.length && <p className="text-sm text-muted-foreground">No comments yet.</p>}
              {top.map((c) => (
                <div key={c._id} className="text-sm">
                  <CommentView c={c} onReply={() => setReplyTo(c._id)} />
                  <div className="ml-6 mt-2 space-y-2 border-l pl-3">
                    {replies(c).map((r) => (
                      <CommentView key={r._id} c={r} />
                    ))}
                  </div>
                </div>
              ))}
              <div className="space-y-2 border-t pt-3">
                {replyTo && (
                  <p className="text-xs text-muted-foreground">
                    Replying to {i.comments.find((c) => c._id === replyTo)?.byName}.{' '}
                    <button className="underline" onClick={() => setReplyTo(null)}>
                      Cancel
                    </button>
                  </p>
                )}
                <Textarea rows={2} aria-label="Write a comment" placeholder="Add a comment" value={text} onChange={(e) => setText(e.target.value)} />
                <Button size="sm" disabled={!text.trim() || comment.isPending} onClick={() => comment.mutate(undefined)}>
                  Comment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {[...i.history].reverse().map((h, k) => (
                <li key={k}>
                  <span className="font-medium">{h.from ? `${ideaStatusLabel(h.from)} → ${ideaStatusLabel(h.to)}` : `Shared`}</span>
                  <span className="block text-xs text-muted-foreground">
                    {dayjs(h.at).format('DD MMM, hh:mm A')} · {h.byName}
                  </span>
                  {h.comment && <span className="block">{h.comment}</span>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
      <IdeaForm open={editing} idea={i} onClose={() => setEditing(false)} />
      <StageDialog open={moving} idea={i} onClose={() => setMoving(false)} />
    </>
  );
}

function CommentView({ c, onReply }: { c: Comment; onReply?: () => void }) {
  return (
    <div>
      <span className="font-medium">{c.byName}</span> <span className="text-xs text-muted-foreground">{dayjs(c.at).format('DD MMM, hh:mm A')}</span>
      <p className="whitespace-pre-wrap">{c.text}</p>
      {onReply && (
        <button className="text-xs text-muted-foreground hover:underline" onClick={onReply}>
          Reply
        </button>
      )}
    </div>
  );
}

function StageDialog({ open, idea, onClose }: { open: boolean; idea: Detail; onClose: () => void }) {
  const [status, setStatus] = useState(idea.status);
  const [comment, setComment] = useState('');
  useEffect(() => {
    if (open) {
      setStatus(idea.status);
      setComment('');
    }
  }, [open, idea]);
  const save = useSend<void>('post', `/ideas/${idea._id}/status`, { invalidate: [['ideas']], success: 'Stage updated', body: () => ({ status, comment }), onSuccess: onClose });
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move this idea</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Stage">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {IDEA_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={status === 'declined' ? 'Why is it declined? (required)' : 'Comment (optional)'}>
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={save.isPending || status === idea.status || (status === 'declined' && !comment.trim())} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
