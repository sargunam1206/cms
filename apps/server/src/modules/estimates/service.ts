import { DEFAULT_RATE_CARD, DEFAULT_VARIANCE, rateCardSchema, varianceSettingsSchema, type EstimateLine, type RateCard, type VarianceSettings } from '@cms/shared';
import { badRequest } from '../../utils/errors';
import { todayStr } from '../../utils/time';
import { getSetting } from '../settings/service';

export const RATE_CARD_KEY = 'rateCard';
export const VARIANCE_KEY = 'varianceSettings';

export async function getRateCard(asOf = todayStr()): Promise<RateCard> {
  const v = await getSetting<RateCard>(RATE_CARD_KEY, asOf);
  const parsed = rateCardSchema.safeParse(v);
  return parsed.success ? parsed.data : DEFAULT_RATE_CARD;
}

export async function getVariance(): Promise<VarianceSettings> {
  return varianceSettingsSchema.parse({ ...DEFAULT_VARIANCE, ...((await getSetting<Partial<VarianceSettings>>(VARIANCE_KEY)) ?? {}) });
}

/** Lines with the current rate for their role frozen into them, plus the totals (paise). */
export async function priceLines(lines: EstimateLine[]) {
  const card = await getRateCard();
  const byRole = new Map(card.roles.map((r) => [r.role.toLowerCase(), r]));
  const unknown = [...new Set(lines.filter((l) => !byRole.has(l.role.toLowerCase())).map((l) => l.role))];
  if (unknown.length) throw badRequest(`No rate for ${unknown.join(', ')} in the rate card`);
  const priced = lines.map((l) => {
    const r = byRole.get(l.role.toLowerCase())!;
    return { module: l.module, task: l.task, role: r.role, hours: l.hours, note: l.note || undefined, costRate: r.costRate, billingRate: r.billingRate };
  });
  const sum = (f: (l: (typeof priced)[number]) => number) => priced.reduce((s, l) => s + f(l), 0);
  return {
    lines: priced,
    totalHours: Math.round(sum((l) => l.hours) * 100) / 100,
    totalCost: Math.round(sum((l) => l.hours * l.costRate)),
    totalBilling: Math.round(sum((l) => l.hours * l.billingRate)),
  };
}

type LineLike = { module: string; task: string; role: string; hours: number; costRate?: number; billingRate?: number };
const keyOf = (l: LineLike) => `${l.module}|${l.task}|${l.role}`.toLowerCase();

/** What changed between two versions, line by line. */
export function compareLines(from: LineLike[], to: LineLike[]) {
  const a = new Map(from.map((l) => [keyOf(l), l]));
  const b = new Map(to.map((l) => [keyOf(l), l]));
  const added = to.filter((l) => !a.has(keyOf(l)));
  const removed = from.filter((l) => !b.has(keyOf(l)));
  const changed = to.filter((l) => a.has(keyOf(l)) && a.get(keyOf(l))!.hours !== l.hours).map((l) => ({ ...l, before: a.get(keyOf(l))!.hours }));
  return { added, removed, changed };
}
