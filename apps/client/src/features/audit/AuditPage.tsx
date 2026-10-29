import { useState } from 'react';
import dayjs from 'dayjs';
import { useDebounced, useGet } from '@/api/hooks';
import type { AuditEntry, Paged } from '@/api/types';
import { PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const da = useDebounced(action);
  const { data } = useGet<Paged<AuditEntry>>(['audit'], '/audit', { action: da || undefined, from: from || undefined, to: to || undefined, page, limit: 50 });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <PageHeader title="Audit Log" description="Append-only record of sensitive actions" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
      <Input
        className="w-72"
        placeholder="Filter by action prefix, e.g. attendance."
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
      />
      <Input type="date" className="w-40" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
      <span className="text-sm text-muted-foreground">to</span>
      <Input type="date" className="w-40" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Who</TH>
                <TH>Action</TH>
                <TH>Entity</TH>
                <TH>Details</TH>
              </TR>
            </THead>
            <TBody>
              {!data?.items.length && <EmptyRow cols={5} />}
              {data?.items.map((a) => (
                <TR key={a._id}>
                  <TD className="whitespace-nowrap">{dayjs(a.createdAt).format('DD MMM YYYY HH:mm:ss')}</TD>
                  <TD>{a.actor?.email ?? 'system'}</TD>
                  <TD className="font-mono text-xs">{a.action}</TD>
                  <TD className="text-xs">
                    {a.entity}
                    {a.entityId && <div className="text-muted-foreground">{a.entityId}</div>}
                  </TD>
                  <TD className="max-w-md truncate font-mono text-xs" title={a.meta ? JSON.stringify(a.meta) : ''}>
                    {a.meta ? JSON.stringify(a.meta) : ''}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <div className="mt-3 flex items-center justify-end gap-2 text-sm">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
    </>
  );
}
