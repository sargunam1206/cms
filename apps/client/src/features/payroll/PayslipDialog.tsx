import dayjs from 'dayjs';
import { Download } from 'lucide-react';
import { downloadFile } from '@/lib/download';
import { Button } from '@/components/ui/button';
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
  layout?: { earnings: { code: string; name: string }[]; deductions: { code: string; name: string }[] };
}

/** Standard rows always appear; ones with no amount show ₹0.00. */
function rows(lines: PayLineResult[], layout?: { code: string; name: string }[]): PayLineResult[] {
  if (!layout) return lines;
  const known = new Set(layout.map((l) => l.code));
  return [...layout.map((l) => lines.find((x) => x.code === l.code) ?? { code: l.code, name: l.name, amount: 0 }), ...lines.filter((x) => !known.has(x.code))];
}

const mask = (v?: string) => (v ? `${'•'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : '—');

/** `own` fetches the PDF through the employee's own route; otherwise the payroll-staff route. */
export function PayslipDialog({ slip, onClose, own }: { slip: PayslipData | null; onClose: () => void; own?: boolean }) {
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
                earnings: rows(slip.earnings, slip.layout?.earnings),
                deductions: rows(slip.deductions, slip.layout?.deductions),
                employerContributions: slip.employerContributions,
                gross: slip.gross,
                totalDeductions: slip.totalDeductions,
                net: slip.net,
                paidDays: slip.attendance.paidDays,
                totalDays: slip.attendance.totalDays,
                warnings: slip.warnings,
              }}
            />
            <Button variant="outline" size="sm" className="w-fit" onClick={() => downloadFile(own ? `/payroll/my/payslips/${slip._id}/pdf` : `/payroll/payslips/${slip._id}/pdf`, `payslip-${slip.month}.pdf`)}>
              <Download /> Download PDF
            </Button>
            <p className="text-xs text-muted-foreground">
              Loss of pay days: {slip.attendance.lopDays} · PAN {mask(slip.person.pan)} · UAN {mask(slip.person.uan)} · Account {mask(slip.person.bank?.accountNumber)}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
