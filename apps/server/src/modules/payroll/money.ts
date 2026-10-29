/** Money is held as integer paise everywhere so sums never drift. */
export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number) => paise / 100;

/** Rounds a fractional paise value half-up (0.5 -> 1). */
export const roundPaise = (p: number) => Math.round(p + Number.EPSILON);

/** Rounds paise up to the next whole rupee (ESI contributions are rounded up). */
export const ceilToRupee = (paise: number) => Math.ceil(paise / 100 - 1e-9) * 100;
