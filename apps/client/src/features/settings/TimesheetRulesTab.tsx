import { useEffect, useState } from 'react';
import { useGet, useSend } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/form-controls';

interface Rules {
  requireApproval: boolean;
  toleranceMinutes: number;
}

export function TimesheetRulesTab() {
  const { data } = useGet<Rules>(['timesheets', 'rules'], '/timesheets/rules');
  const [f, setF] = useState<Rules>({ requireApproval: false, toleranceMinutes: 30 });
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  const save = useSend('put', '/timesheets/rules', { invalidate: [['timesheets']], success: 'Timesheet rules saved', body: () => f });
  return (
    <Card>
      <CardContent className="space-y-4 pt-5 text-sm">
        <Field label="Allowance above attendance (minutes)">
          <Input className="w-32" type="number" min={0} max={240} value={f.toleranceMinutes} onChange={(e) => setF({ ...f, toleranceMinutes: Number(e.target.value) })} />
        </Field>
        <p className="max-w-xl text-muted-foreground">
          A day's logged time cannot exceed the hours attendance shows plus this allowance (for breaks and rounding). Time cannot be logged on week-offs, holidays, leave, or days with no attendance.
        </p>
        <label className="flex items-center gap-2 font-medium">
          <Checkbox checked={f.requireApproval} onChange={(e) => setF({ ...f, requireApproval: e.target.checked })} /> Weekly timesheets need manager approval
        </label>
        <p className="max-w-xl text-muted-foreground">
          On: employees submit each week; it locks until the reporting manager (or HR) approves it or sends it back. Off: logged time counts straight away.
        </p>
        <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
