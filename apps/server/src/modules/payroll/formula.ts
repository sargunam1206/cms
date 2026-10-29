import { create, all, type MathNode } from 'mathjs';

// A locked-down mathjs: expressions may only do arithmetic and use a few safe functions.
const math = create(all);
const parse = math.parse;
const evaluate = math.evaluate;
math.import(
  {
    import: () => { throw new Error('Disabled'); },
    createUnit: () => { throw new Error('Disabled'); },
    reviver: () => { throw new Error('Disabled'); },
    parse: () => { throw new Error('Disabled'); },
    simplify: () => { throw new Error('Disabled'); },
    derivative: () => { throw new Error('Disabled'); },
    evaluate: () => { throw new Error('Disabled'); },
    resolve: () => { throw new Error('Disabled'); },
  },
  { override: true },
);

const ALLOWED_FUNCS = new Set(['min', 'max', 'round', 'floor', 'ceil', 'abs']);

export class FormulaError extends Error {}

/** Names of the component codes a formula refers to; rejects anything beyond arithmetic and a few functions. */
export function formulaDependencies(expr: string): string[] {
  let node: MathNode;
  try {
    node = parse(expr);
  } catch {
    throw new FormulaError(`Cannot read formula "${expr}"`);
  }
  const deps = new Set<string>();
  node.traverse((n: MathNode, _path: string, parent: MathNode | null) => {
    const t = n.type;
    if (t === 'SymbolNode') {
      const name = (n as unknown as { name: string }).name;
      const isFuncName = parent?.type === 'FunctionNode' && (parent as unknown as { fn: MathNode }).fn === n;
      if (isFuncName) {
        if (!ALLOWED_FUNCS.has(name)) throw new FormulaError(`Function "${name}" is not allowed`);
      } else deps.add(name);
    } else if (!['ConstantNode', 'OperatorNode', 'ParenthesisNode', 'FunctionNode'].includes(t)) {
      throw new FormulaError(`Formula "${expr}" uses something that is not plain arithmetic`);
    }
  });
  return [...deps];
}

/** Evaluates a formula with the given variables (component codes -> rupees). Returns rupees. */
export function evaluateFormula(expr: string, scope: Record<string, number>): number {
  formulaDependencies(expr);
  const v = evaluate(expr, { ...scope });
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new FormulaError(`Formula "${expr}" did not produce a number`);
  return v;
}
