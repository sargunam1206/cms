import { MEETING_TYPE_LABEL, type MeetingType } from '@cms/shared';

export interface Person {
  _id: string;
  name: string;
  code: string;
  department?: string;
  designation?: string;
  type?: string;
}

export interface MeetingAction {
  _id?: string;
  text: string;
  owner?: Person | string | null;
  dueDate?: string | null;
  done: boolean;
}

export interface MeetingRow {
  _id: string;
  title: string;
  type: MeetingType;
  status: 'scheduled' | 'completed' | 'cancelled';
  date: string;
  start: string;
  end: string;
  location?: string;
  link?: string;
  organizer: Person;
  project?: { _id: string; code: string; name: string } | null;
  client?: { _id: string; name: string } | null;
  attendeeCount: number;
  openActions: number;
}

export interface MeetingDetail extends Omit<MeetingRow, 'attendeeCount' | 'openActions'> {
  attendees: Person[];
  guests?: string;
  agenda?: string;
  minutes?: string;
  actions: MeetingAction[];
  canEdit: boolean;
  isOrganizer: boolean;
}

export interface MeetingOptions {
  people: Person[];
  projects: { _id: string; code: string; name: string }[];
  clients: { _id: string; name: string }[];
  canLinkClients: boolean;
}

export const typeLabel = (t: string) => MEETING_TYPE_LABEL[t as MeetingType] ?? t;
export const TYPE_TONE: Record<string, string> = {
  internal: 'bg-blue-100 text-blue-800',
  client: 'bg-emerald-100 text-emerald-800',
  interior_site_visit: 'bg-amber-100 text-amber-800',
  other: 'bg-slate-100 text-slate-700',
};
export const personId = (p: Person | string | null | undefined) => (p && typeof p === 'object' ? p._id : (p ?? ''));
