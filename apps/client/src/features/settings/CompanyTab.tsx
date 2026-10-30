import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CompanyProfile } from '@cms/shared';
import { api, apiError } from '@/api/client';
import { useGet, useSend } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form-controls';

type Company = CompanyProfile & { hasLogo: boolean; hasSignature: boolean };

const BLANK: CompanyProfile = { name: '', address: '', phone: '', email: '', website: '', gstin: '', pan: '', tan: '', pfRegNo: '', esiRegNo: '', signatoryName: '', signatoryTitle: '' };

/** The API needs the auth header, so images are fetched as blobs rather than used as plain <img src>. */
function useImage(kind: 'logo' | 'signature', present: boolean, version: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    if (!present) {
      setUrl(null);
      return;
    }
    api.get<Blob>(`/company/${kind}`, { responseType: 'blob' }).then((r) => {
      if (cancelled) return;
      made = URL.createObjectURL(r.data);
      setUrl(made);
    }).catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [kind, present, version]);
  return url;
}

function ImageBox({ kind, label, hint, present }: { kind: 'logo' | 'signature'; label: string; hint: string; present: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const url = useImage(kind, present, version);
  const refresh = () => {
    setVersion((v) => v + 1);
    qc.invalidateQueries({ queryKey: ['company'] });
  };

  const upload = async (file: File) => {
    if (file.size > 1_000_000) return toast.error('Image is larger than 1 MB. Use a smaller file.');
    try {
      await api.put(`/company/${kind}`, file, { headers: { 'Content-Type': 'application/octet-stream' } });
      toast.success(`${label} saved`);
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };
  const remove = async () => {
    try {
      await api.delete(`/company/${kind}`);
      toast.success(`${label} removed`);
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="flex h-24 w-56 items-center justify-center rounded-md border bg-muted/30">
        {url ? <img src={url} alt={label} className="max-h-20 max-w-52 object-contain" /> : <span className="text-xs text-muted-foreground">None</span>}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = '';
        }}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}>
          {present ? 'Replace' : 'Upload'}
        </Button>
        {present && (
          <Button type="button" size="sm" variant="ghost" onClick={remove}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

export function CompanyTab() {
  const { data } = useGet<Company>(['company'], '/company');
  const [f, setF] = useState<CompanyProfile>(BLANK);
  useEffect(() => {
    if (data) setF({ ...BLANK, ...data });
  }, [data]);
  const save = useSend('put', '/company', { invalidate: [['company']], success: 'Company details saved', body: () => f });
  const set = (k: keyof CompanyProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company details</CardTitle>
          <p className="text-sm text-muted-foreground">Printed in the header of payslips. Leave a field empty to leave it off.</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" className="sm:col-span-2">
            <Input value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea rows={3} value={f.address ?? ''} onChange={set('address')} placeholder={'Street, area\nCity - PIN'} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone ?? ''} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label="Website">
            <Input value={f.website ?? ''} onChange={set('website')} />
          </Field>
          <span />
          <Field label="GSTIN">
            <Input value={f.gstin ?? ''} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} placeholder="33ABCDE1234F1Z5" />
          </Field>
          <Field label="PAN">
            <Input value={f.pan ?? ''} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" />
          </Field>
          <Field label="TAN">
            <Input value={f.tan ?? ''} onChange={(e) => setF({ ...f, tan: e.target.value.toUpperCase() })} placeholder="CHEA12345B" />
          </Field>
          <span />
          <Field label="PF registration number">
            <Input value={f.pfRegNo ?? ''} onChange={set('pfRegNo')} />
          </Field>
          <Field label="ESI registration number">
            <Input value={f.esiRegNo ?? ''} onChange={set('esiRegNo')} />
          </Field>
          <Field label="Signatory name (printed under the signature)">
            <Input value={f.signatoryName ?? ''} onChange={set('signatoryName')} />
          </Field>
          <Field label="Signatory designation">
            <Input value={f.signatoryTitle ?? ''} onChange={set('signatoryTitle')} />
          </Field>
          <div className="sm:col-span-2">
            <Button disabled={save.isPending || f.name.trim().length < 2} onClick={() => save.mutate(undefined)}>
              Save details
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logo and signature</CardTitle>
          <p className="text-sm text-muted-foreground">PNG or JPEG, up to 1 MB. These save as soon as you pick the file.</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-8">
          <ImageBox kind="logo" label="Company logo" hint="Shown at the top left of payslips. A wide or square image on a white or transparent background works best." present={!!data?.hasLogo} />
          <ImageBox kind="signature" label="Authorised signature" hint="Shown bottom right of payslips, above the signatory name. Crop it close to the signature." present={!!data?.hasSignature} />
        </CardContent>
      </Card>
    </div>
  );
}
