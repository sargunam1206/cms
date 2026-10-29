import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import dayjs from 'dayjs';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtDate = (d?: string | Date | null) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
export const fmtTime = (d?: string | Date | null) => (d ? dayjs(d).format('hh:mm A') : '—');
export const fmtMinutes = (m?: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '—');
export const thisMonth = () => dayjs().format('YYYY-MM');
