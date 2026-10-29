import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-controls';
import type { PayComponent, PayLine } from './types';

/** Editor for the list of components and their values (a fixed monthly amount or a formula like BASIC*0.4). */
export function LinesEditor({ lines, components, onChange }: { lines: PayLine[]; components: PayComponent[]; onChange: (l: PayLine[]) => void }) {
  const used = new Set(lines.map((l) => l.code));
  const free = components.filter((c) => c.active && !used.has(c.code));
  const set = (i: number, patch: Partial<PayLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const isFormula = (l: PayLine) => l.formula !== undefined;

  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const c = components.find((x) => x.code === l.code);
        return (
          <div key={l.code} className="flex flex-wrap items-center gap-2">
            <div className="w-40 text-sm">
              <span className="font-medium">{l.code}</span>
              <div className="text-xs text-muted-foreground">
                {c?.name} · {c?.kind}
              </div>
            </div>
            <Select
              className="w-28"
              value={isFormula(l) ? 'formula' : 'fixed'}
              onChange={(e) => onChange(lines.map((x, j) => (j === i ? (e.target.value === 'formula' ? { code: x.code, formula: '' } : { code: x.code, fixedAmount: 0 }) : x)))}
            >
              <option value="fixed">Fixed ₹</option>
              <option value="formula">Formula</option>
            </Select>
            {isFormula(l) ? (
              <Input className="w-56" placeholder="e.g. BASIC*0.4" value={l.formula ?? ''} onChange={(e) => set(i, { formula: e.target.value.toUpperCase() })} />
            ) : (
              <Input className="w-36" type="number" min={0} value={l.fixedAmount ?? 0} onChange={(e) => set(i, { fixedAmount: Number(e.target.value) })} />
            )}
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${l.code}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        );
      })}
      {free.length > 0 && (
        <Select
          className="w-64"
          value=""
          onChange={(e) => e.target.value && onChange([...lines, { code: e.target.value, fixedAmount: 0 }])}
          aria-label="Add component"
        >
          <option value="">+ Add component…</option>
          {free.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </Select>
      )}
      {lines.length === 0 && (
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <Plus className="h-3 w-3" /> Add at least one component.
        </p>
      )}
    </div>
  );
}
