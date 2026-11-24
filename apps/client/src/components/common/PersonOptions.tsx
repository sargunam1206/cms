import type { ReactNode } from 'react';

export interface TypedPerson {
  _id: string;
  name: string;
  code?: string;
  /** 'intern' for interns; employees may have no type on older records. */
  type?: string;
}

/** Splits people into employees and interns, keeping their order. */
export function splitPeople<T extends TypedPerson>(people: T[]) {
  return { employees: people.filter((p) => p.type !== 'intern'), interns: people.filter((p) => p.type === 'intern') };
}

/**
 * The <option>s for a people dropdown, grouped under "Employees" and "Interns" so the two are never mixed up.
 * With no interns in the list it is a plain list.
 */
export function PersonOptions<T extends TypedPerson>({ people, label = (p) => (p.code ? `${p.name} (${p.code})` : p.name) }: { people: T[]; label?: (p: T) => ReactNode }) {
  const { employees, interns } = splitPeople(people);
  const opts = (list: T[]) =>
    list.map((p) => (
      <option key={p._id} value={p._id}>
        {label(p)}
      </option>
    ));
  if (!interns.length) return <>{opts(employees)}</>;
  return (
    <>
      {!!employees.length && <optgroup label="Employees">{opts(employees)}</optgroup>}
      <optgroup label="Interns">{opts(interns)}</optgroup>
    </>
  );
}
