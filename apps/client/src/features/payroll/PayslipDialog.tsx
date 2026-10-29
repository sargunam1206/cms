import dayjs from 'dayjs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PreviewTable } from './SalaryDialog';
import type { PayLineResult } from './types';

export interface PayslipData {
  _id: string;
  month: string;
  person: { name: string; code: string; designation?: string; department?: string; pan?: string; uan?: string; bank?: { accountNumber?: string; ifsc?: string; bankName?: string } };
  attendance: { totalDays: number; paidDays: number; lopDays: number };
  earnings: PayLineResult[];
  deductions: PayLineResult[];
  employerContributions: PayLineResult[];
  gross: number;
  totalDeductions: number;
  net: number;
  warnings: string[];
}

const mask = (v?: string) => (v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : '—');

export function PayslipDialog({ slip, onClose }: { slip: PayslipData | null; onClose: () => void }) {
  return (
    <Dialog open={!!slip} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {slip && (
          <>
            <DialogHeader>
              <DialogTitle>
                Payslip · {dayjs(`${slip.month}-01`).format('MMMM YYYY')}
              </DialogTitle>
              <DialogDescription>
                {slip.person.name} ({slip.person.code}){slip.person.designation ? ` · ${slip.person.designation}` : ''}
                {slip.person.department ? ` · ${slip.person.department}` : ''}
              </DialogDescription>
            </DialogHeader>
            <PreviewTable
              p={{
                month: slip.month,
                employee: { name: slip.person.name, code: slip.person.code },
                earnings: slip.earnings,
                deductions: slip.deductions,
                employerContributions: slip.employerContributions,
                gross: slip.gross,
                totalDeductions: slip.totalDeductions,
                net: slip.net,
                paidDays: slip.attendance.paidDays,
                totalDays: slip.attendance.totalDays,
                warnings: slip.warnings,
              }}
            />
            <p className="text-xs text-muted-foreground">
              Loss of pay days: {slip.attendance.lopDays} · PAN {mask(slip.person.pan)} · UAN {mask(slip.person.uan)} · Account {mask(slip.person.bank?.accountNumber)}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
