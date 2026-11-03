import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import dayjs from 'dayjs';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtDate = (d?: string | Date | null) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
export const fmtTime = (d?: string | Date | null) => (d ? dayjs(d).format('hh:mm A') : '—');
/** Lateness as "45 min", "1 hr" or "1 hr 11 min" (minutes under an hour, hours and minutes beyond). */
export const fmtLate = (m?: number) => {
  const t = Math.max(0, Math.round(m ?? 0));
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  const r = t % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
};
export const fmtMinutes = (m?: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');
export const thisMonth = () => dayjs().format('YYYY-MM');
