import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiError } from '@/api/client';
import { downloadFile } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useQueryClient } from '@tanstack/react-query';

interface Row {
  row: number;
  code: string;
  name?: string;
  effectiveFrom?: string;
  lines?: { code: string; fixedAmount?: number; formula?: string }[];
  errors: string[];
}
interface Result {
  applied: number;
  errors: number;
  rows: Row[];
}

/** Bulk salary entry: download a sheet with everyone's current pay, edit it in Excel, upload it, check, apply. */
export function SalaryImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const file = useRef<File | null>(null);
  const [name, setName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (apply: boolean) => {
    if (!file.current) return;
    setBusy(true);
    try {
      const { data } = await api.post<Result>(`/payroll/salary-import${apply ? '?apply=1' : ''}`, file.current, { headers: { 'Content-Type': 'application/octet-stream' } });
      setResult(data);
      if (apply) {
        toast.success(`Salaries saved for ${data.applied} employee(s)`);
        qc.invalidateQueries({ queryKey: ['payroll'] });
        close();
      }
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    file.current = null;
    setName('');
    setResult(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import salaries from Excel</DialogTitle>
          <DialogDescription>Set pay for many employees at once. The file is checked first and nothing is saved until you confirm.</DialogDescription>
        </DialogHeader>

        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>
            <Button variant="outline" size="sm" onClick={() => downloadFile('/payroll/salary-template', 'salary-template.xlsx')}>
              <Download /> Download the sheet
            </Button>{' '}
            (it lists every active employee and their current pay)
          </li>
          <li>Fill in or change the amounts in rupees. For a formula type <code>f:BASIC*0.4</code>. Set the Effective-from date. See the "How to fill" tab.</li>
          <li>
            Choose the file:{' '}
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                file.current = e.target.files?.[0] ?? null;
                setName(file.current?.name ?? '');
                setResult(null);
              }}
            />
          </li>
        </ol>

        <Button disabled={!name || busy} variant="outline" className="w-fit" onClick={() => send(false)}>
          <Upload /> Check file
        </Button>

        {result && (
          <div className="space-y-2">
            <p className={`text-sm font-medium ${result.errors ? 'text-destructive' : 'text-emerald-700'}`}>
              {result.rows.length} row(s) read, {result.errors} with problems.
              {result.errors ? ' Fix the file and check again; nothing is saved while any row has a problem.' : ' Everything looks valid.'}
            </p>
            <div className="max-h-64 overflow-y-auto rounded-md border text-sm">
              {result.rows.map((r) => (
                <div key={r.row} className="flex justify-between gap-3 border-b px-3 py-1 last:border-0">
                  <span>
                    Row {r.row} · {r.code} {r.name && `· ${r.name}`}
                  </span>
                  <span className={r.errors.length ? 'text-destructive' : 'text-muted-foreground'}>
                    {r.errors.length ? r.errors.join('; ') : `${r.lines?.length} component(s) from ${r.effectiveFrom}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button disabled={!result || result.errors > 0 || result.rows.length === 0 || busy} onClick={() => send(true)}>
            Apply to {result?.rows.length ?? 0} employee(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
