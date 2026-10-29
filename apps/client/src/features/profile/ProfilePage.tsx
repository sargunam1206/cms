import { useState, type ReactNode } from 'react';
import { KeyRound, Pencil } from 'lucide-react';
import { useGet } from '@/api/hooks';
import type { Employee } from '@/api/types';
import { fmtDate } from '@/lib/utils';
import { ChangePasswordDialog } from '@/components/common/ChangePasswordDialog';
import { PageHeader, Spinner } from '@/components/common/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BankChangeDialog, EditPhoneDialog } from './ProfileDialogs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Profile {
  email: string;
  role: string;
  employee: (Omit<Employee, 'manager'> & { manager?: (Employee & { designation?: string }) | null }) | null;
}

function Row({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children || '—'}</span>
    </div>
  );
}

/** Mask all but the last 4 characters of an identifier. */
const mask = (v?: string) => (v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : undefined);

export function ProfilePage() {
  const { data, isLoading } = useGet<Profile>(['profile'], '/auth/profile');
  const [pwOpen, setPwOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const changes = useGet<{ _id: string; status: string; bank: { bankName: string } }[]>(['profile', 'bank-changes'], '/profile/bank-changes');
  const pendingBank = changes.data?.find((c) => c.status === 'pending');
  if (isLoading || !data) return <Spinner />;
  const e = data.employee;

  return (
    <>
      <PageHeader
        title="My Profile"
        description="You can update your phone and request bank changes; contact HR for anything else."
        actions={
          <Button variant="outline" onClick={() => setPwOpen(true)}>
            <KeyRound /> Change password
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <Row label="Name">{e?.name}</Row>
            <Row label="Login email">{data.email}</Row>
            <Row label="Role">
              <Badge>{data.role}</Badge>
            </Row>
            <Row label="Status">{e && <Badge variant={e.status === 'active' ? 'success' : 'warning'}>{e.status}</Badge>}</Row>
          </CardContent>
        </Card>

        {e ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Employment</CardTitle>
              </CardHeader>
              <CardContent>
                <Row label="Employee code">{e.code}</Row>
                <Row label="Department">{e.department}</Row>
                <Row label="Designation">{e.designation}</Row>
                <Row label="Reports to">{e.manager ? `${e.manager.name} (${e.manager.code})` : undefined}</Row>
                <Row label="Date of joining">{fmtDate(e.dateOfJoining)}</Row>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Personal</CardTitle>
              </CardHeader>
              <CardContent>
                <Row label="Work email">{e.email}</Row>
                <Row label="Phone">
                  {e.phone}{' '}
                  <Button size="sm" variant="ghost" onClick={() => setPhoneOpen(true)} aria-label="Edit phone">
                    <Pencil />
                  </Button>
                </Row>
                <Row label="Date of birth">{e.dateOfBirth ? fmtDate(e.dateOfBirth) : undefined}</Row>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Statutory & bank</CardTitle>
              </CardHeader>
              <CardContent>
                <Row label="PAN">{mask(e.pan)}</Row>
                <Row label="UAN">{mask(e.uan)}</Row>
                <Row label="ESI number">{mask(e.esiNumber)}</Row>
                <Row label="Bank">{e.bank?.bankName}</Row>
                <Row label="Account number">{mask(e.bank?.accountNumber)}</Row>
                <Row label="IFSC">{e.bank?.ifsc}</Row>
                <div className="flex items-center justify-between gap-2 pt-3">
                  {pendingBank ? <Badge variant="warning">Change to {pendingBank.bank.bankName} awaiting HR approval</Badge> : <span />}
                  <Button size="sm" variant="outline" onClick={() => setBankOpen(true)}>
                    Request change
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No employee record is linked to this login.</p>
        )}
      </div>
      <EditPhoneDialog open={phoneOpen} phone={e?.phone} onClose={() => setPhoneOpen(false)} />
      <BankChangeDialog open={bankOpen} onClose={() => setBankOpen(false)} />
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </>
  );
}
