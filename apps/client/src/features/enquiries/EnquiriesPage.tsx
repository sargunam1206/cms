import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { PERMISSIONS as P } from '@cms/shared';
import { useDebounced, useGet } from '@/api/hooks';
import type { Paged } from '@/api/types';
import { useAuth } from '@/lib/auth';
import { cn, fmtDate } from '@/lib/utils';
import { PageHeader, Pager, Spinner, Stat } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnquiryForm } from './EnquiryForm';
import type { EnquiryRow, Options, Summary } from './types';

export function StatusBadge({ status, o }: { status: string; o?: Options }) {
  const tone = status === o?.won ? 'text-green-700' : status === o?.lost ? 'text-red-700' : '';
  return (
    <Badge variant="outline" className={tone}>
      {status}
    </Badge>
  );
}

export function FollowUp({ e }: { e: EnquiryRow }) {
  if (!e.nextFollowUp) return <span className="text-muted-foreground">—</span>;
  return <span className={cn(e.overdue && 'font-medium text-red-700')}>{fmtDate(e.nextFollowUp)}{e.overdue && ' (overdue)'}</span>;
}

export function EnquiriesPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const sees = can(P.ENQUIRIES_VIEW) || can(P.ENQUIRIES_MANAGE);
  const writes = can(P.ENQUIRIES_SELF) || can(P.ENQUIRIES_MANAGE);
  const [f, setF] = useState({ q: '', status: '', source: '', owner: '', due: '' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(f.q);
  const options = useGet<Options>(['enquiries', 'options'], '/enquiries/options');
  const summary = useGet<Summary>(['enquiries', 'summary'], '/enquiries/summary');
  const list = useGet<Paged<EnquiryRow>>(['enquiries', 'list'], '/enquiries', { q: dq || undefined, status: f.status || undefined, source: f.source || undefined, owner: f.owner || undefined, due: f.due || undefined, page, limit: 25 });
  const board = useGet<Paged<EnquiryRow>>(['enquiries', 'board'], '/enquiries', { limit: 500 });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setF({ ...f, [k]: e.target.value });
    setPage(1);
  };
  const o = options.data;
  const s = summary.data;

  return (
    <>
      <PageHeader
        title="Enquiries"
        description={sees ? 'Every sales enquiry.' : o?.viewsOthers ? "Your enquiries and your team's. You can open the team's, but only the owner changes them." : 'Your sales enquiries.'}
        actions={
          writes && (
            <Button onClick={() => setAdding(true)}>
              <Plus /> New enquiry
            </Button>
          )
        }
      />
      {s && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Open" value={s.open} />
          <Stat label="Follow-ups due today" value={s.dueToday} tone={s.dueToday ? 'warn' : undefined} />
          <Stat label="Overdue" value={s.overdue} tone={s.overdue ? 'bad' : undefined} />
          <Stat label="Won / closed" value={s.conversionRate == null ? '—' : `${s.conversionRate}%`} />
        </div>
      )}

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="board">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-60">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Name, company or phone" aria-label="Search enquiries" value={f.q} onChange={set('q')} />
            </div>
            <Select className="w-40" aria-label="Status" value={f.status} onChange={set('status')}>
              <option value="">All statuses</option>
              {o && [...o.stages, o.won, o.lost].map((x) => <option key={x}>{x}</option>)}
            </Select>
            <Select className="w-40" aria-label="Source" value={f.source} onChange={set('source')}>
              <option value="">All sources</option>
              {o?.sources.map((x) => <option key={x}>{x}</option>)}
            </Select>
            <Select className="w-40" aria-label="Follow-up" value={f.due} onChange={set('due')}>
              <option value="">Any follow-up</option>
              <option value="today">Due today</option>
              <option value="overdue">Overdue</option>
              <option value="week">Due within a week</option>
            </Select>
            {(sees || o?.viewsOthers) && (
              <Select className="w-44" aria-label="Owner" value={f.owner} onChange={set('owner')}>
                <option value="">{sees ? 'Everyone' : 'Me and my team'}</option>
                <option value="me">Mine</option>
              </Select>
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Company</TH>
                    <TH>Status</TH>
                    <TH>Source</TH>
                    <TH>Owner</TH>
                    <TH>Next follow-up</TH>
                  </TR>
                </THead>
                <TBody>
                  {!list.data?.items.length && <EmptyRow cols={6} text={list.isLoading ? 'Loading…' : 'No enquiries match'} />}
                  {list.data?.items.map((e) => (
                    <TR key={e._id} className="cursor-pointer hover:bg-muted/40" onClick={() => nav(`/enquiries/${e._id}`)}>
                      <TD>
                        <Link to={`/enquiries/${e._id}`} className="font-medium hover:underline" onClick={(ev) => ev.stopPropagation()}>
                          {e.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{e.phone}</div>
                      </TD>
                      <TD>{e.company ?? '—'}</TD>
                      <TD>
                        <StatusBadge status={e.status} o={o} />
                      </TD>
                      <TD>{e.source}</TD>
                      <TD>{e.owner?.name}</TD>
                      <TD>
                        <FollowUp e={e} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
          {list.data && <Pager page={list.data.page} limit={list.data.limit} total={list.data.total} onPage={setPage} />}
        </TabsContent>

        <TabsContent value="board">
          {!o || !board.data ? (
            <Spinner />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {[...o.stages, o.won, o.lost].map((col) => {
                const items = board.data.items.filter((e) => e.status === col);
                return (
                  <section key={col} aria-label={`${col} column`} className="w-64 shrink-0 rounded-lg bg-muted/50 p-2">
                    <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                      {col} <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
                    </h3>
                    <ul className="space-y-2">
                      {items.map((e) => (
                        <li key={e._id}>
                          <Link to={`/enquiries/${e._id}`} className="block rounded-md border bg-card p-2 text-sm shadow-sm hover:border-primary">
                            <span className="font-medium">{e.name}</span>
                            {e.company && <span className="block text-xs text-muted-foreground">{e.company}</span>}
                            <span className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                              <span>{e.owner?.name}</span>
                              {col !== o.won && col !== o.lost && <FollowUp e={e} />}
                            </span>
                          </Link>
                        </li>
                      ))}
                      {!items.length && <li className="px-1 py-3 text-xs text-muted-foreground">Nothing here</li>}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
      <EnquiryForm open={adding} enquiry={null} onClose={() => setAdding(false)} onSaved={(id) => nav(`/enquiries/${id}`)} />
    </>
  );
}
