import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Checkbox, Input } from '@/components/ui/form-controls';

export interface PickPerson {
  _id: string;
  name: string;
  code?: string;
  department?: string;
  designation?: string;
}

/**
 * Choose several people at once: search, tick as many as needed, or select everyone shown (e.g. a whole
 * department after searching for it). The chosen ones stay listed above as removable chips.
 */
export function PeoplePicker({ people, value, onChange, label = 'people' }: { people: PickPerson[]; value: string[]; onChange: (ids: string[]) => void; label?: string }) {
  const [q, setQ] = useState('');
  const chosen = new Set(value);
  const byId = useMemo(() => new Map(people.map((p) => [p._id, p])), [people]);
  const shown = people.filter((p) => `${p.name} ${p.code ?? ''} ${p.department ?? ''} ${p.designation ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const allShown = shown.length > 0 && shown.every((p) => chosen.has(p._id));
  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  const toggleShown = () => {
    if (allShown) onChange(value.filter((id) => !shown.some((p) => p._id === id)));
    else onChange([...new Set([...value, ...shown.map((p) => p._id)])]);
  };

  return (
    <div className="space-y-2">
      {!!value.length && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {byId.get(id)?.name ?? '…'}
              <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? ''}`} onClick={() => toggle(id)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="rounded-md border">
        <div className="flex items-center gap-2 border-b p-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input className="h-8 pl-7" placeholder="Search name, code or department" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${label}`} />
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-xs">
            <Checkbox checked={allShown} onChange={toggleShown} aria-label="Select all shown" /> All shown
          </label>
          {!!value.length && (
            <button type="button" className="shrink-0 text-xs text-muted-foreground hover:underline" onClick={() => onChange([])}>
              Clear
            </button>
          )}
        </div>
        <div className="max-h-48 overflow-y-auto p-1" role="group" aria-label={`Choose ${label}`}>
          {!shown.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">No one matches.</p>}
          {shown.map((p) => (
            <label key={p._id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
              <Checkbox checked={chosen.has(p._id)} onChange={() => toggle(p._id)} aria-label={p.name} />
              <span className="font-medium">{p.name}</span>
              <span className="truncate text-xs text-muted-foreground">{[p.code, p.department ?? p.designation].filter(Boolean).join(' · ')}</span>
            </label>
          ))}
        </div>
        <div className="border-t px-2 py-1 text-xs text-muted-foreground">
          {value.length} selected of {people.length}
        </div>
      </div>
    </div>
  );
}
