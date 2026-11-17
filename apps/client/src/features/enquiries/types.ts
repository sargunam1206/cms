import type { EmployeeRef } from '@/api/types';

export interface Options {
  sources: string[];
  stages: string[];
  lostReasons: string[];
  won: string;
  lost: string;
  /** the caller can see more than their own enquiries (all of them, or their team's) */
  viewsOthers?: boolean;
}
export interface Activity {
  _id: string;
  at: string;
  byName?: string;
  kind: 'created' | 'note' | 'status' | 'followup' | 'owner' | 'edit' | 'converted';
  text?: string;
}
export interface EnquiryRow {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  source: string;
  status: string;
  owner: EmployeeRef;
  nextFollowUp?: string;
  lostReason?: string;
  overdue: boolean;
  project?: { _id: string; code: string; name: string } | null;
  client?: { _id: string; name: string } | null;
}
export interface EnquiryDetail extends EnquiryRow {
  activity: Activity[];
  canWrite: boolean;
  canConvert: boolean;
}
export interface Summary {
  byStatus: Record<string, number>;
  open: number;
  dueToday: number;
  overdue: number;
  won: number;
  lost: number;
  conversionRate: number | null;
}
export interface DupMatch {
  _id?: string;
  name: string;
  company?: string;
  status: string;
  owner?: string;
}

export const isClosed = (o: Options, status: string) => status === o.won || status === o.lost;
