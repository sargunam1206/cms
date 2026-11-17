import { useEffect, useState } from 'react';
import { useGet, useSend } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/form-controls';

interface Options {
  sources: string[];
  stages: string[];
  lostReasons: string[];
}
const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);

/** The dropdown values on enquiries: one per line. */
export function EnquiryOptionsTab() {
  const { data } = useGet<Options>(['enquiries', 'options'], '/enquiries/options');
  const [f, setF] = useState({ sources: '', stages: '', lostReasons: '' });
  useEffect(() => {
    if (data) setF({ sources: data.sources.join('\n'), stages: data.stages.join('\n'), lostReasons: data.lostReasons.join('\n') });
  }, [data]);
  const save = useSend<void>('put', '/enquiries/options', {
    invalidate: [['enquiries']],
    success: 'Enquiry options saved',
    body: () => ({ sources: lines(f.sources), stages: lines(f.stages), lostReasons: lines(f.lostReasons) }),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <CardContent className="space-y-4 pt-5 text-sm">
        <p className="max-w-2xl text-muted-foreground">One value per line. Stages are in pipeline order; new enquiries start in the first. Won and Lost always exist after the last stage. A stage that enquiries are still in cannot be removed.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Sources">
            <Textarea rows={8} value={f.sources} onChange={set('sources')} />
          </Field>
          <Field label="Stages">
            <Textarea rows={8} value={f.stages} onChange={set('stages')} />
          </Field>
          <Field label="Lost reasons">
            <Textarea rows={8} value={f.lostReasons} onChange={set('lostReasons')} />
          </Field>
        </div>
        <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
