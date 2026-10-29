import { useGet, useSend } from '@/api/hooks';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Spinner } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

interface Bank {
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
}
interface Req {
  _id: string;
  createdAt: string;
  bank: Bank;
  employee: { name: string; code: string; bank?: Bank };
}

const show = (b?: Bank) => (b?.accountNumber ? `${b.bankName ?? ''} · ${b.accountNumber} · ${b.ifsc ?? ''}` : '—');

/** HR: approve or reject bank detail changes requested by employees. */
export function BankChangesPage() {
  const { data, isLoading } = useGet<Req[]>(['profile', 'bank-changes', 'pending'], '/profile/bank-changes/pending');
  const decide = useSend<{ id: string; decision: 'approved' | 'rejected' }>('post', (v) => `/profile/bank-changes/${v.id}/decision`, {
    invalidate: [['profile'], ['employees']],
    body: (v) => ({ decision: v.decision }),
    success: 'Done',
  });
  if (isLoading || !data) return <Spinner />;
  return (
    <>
      <PageHeader title="Bank detail changes" description="Verify against a bank proof (passbook or cancelled cheque) before approving" />
      <Table>
        <THead>
          <TR>
            <TH>Employee</TH>
            <TH>Requested</TH>
            <TH>Current</TH>
            <TH>New</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {data.length === 0 && <EmptyRow cols={5} text="No pending requests" />}
          {data.map((r) => (
            <TR key={r._id}>
              <TD>
                {r.employee.name} ({r.employee.code})
              </TD>
              <TD>{fmtDate(r.createdAt)}</TD>
              <TD>{show(r.employee.bank)}</TD>
              <TD>{show(r.bank)}</TD>
              <TD className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: r._id, decision: 'approved' })}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: r._id, decision: 'rejected' })}>
                    Reject
                  </Button>
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
