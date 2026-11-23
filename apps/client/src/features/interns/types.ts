export interface PersonRef {
  _id: string;
  name: string;
  code?: string;
  designation?: string;
  department?: string;
}

export interface InternRow {
  _id: string; // the intern's employee id
  employee: PersonRef & { email?: string; phone?: string; status: string };
  college: string;
  course?: string;
  startDate: string;
  endDate: string;
  mentor?: PersonRef | null;
  status: InternStatus;
  stipend: number;
  onboarding: { done: number; total: number };
  work: { total: number; approved: number; submitted: number };
}

export type InternStatus = 'onboarding' | 'active' | 'completed' | 'dropped' | 'converted';

export interface InternDetail {
  _id: string;
  employee: PersonRef & { email?: string; phone?: string; status: string; type: string };
  college: string;
  course?: string;
  yearOfStudy?: string;
  startDate: string;
  endDate: string;
  mentor?: PersonRef | null;
  status: InternStatus;
  stipend?: number;
  checklist: { _id: string; label: string; done: boolean; doneAt?: string; doneByName?: string; note?: string }[];
  stipendPayments?: { _id: string; month: string; amount: number; paidOn: string; note?: string; byName?: string }[];
  allocations: { _id: string; project: { _id: string; code: string; name: string }; from: string; to?: string; note?: string; byName?: string }[];
  completion?: { date?: string; rating?: number; feedback?: string; certificateIssued?: boolean; byName?: string };
  history: { at: string; byName?: string; from?: string; to: string }[];
  documents: { _id: string; title: string; name: string; size: number; uploadedByName?: string; createdAt: string }[];
  login: { email: string; status: string } | null;
  canManage: boolean;
  canGuide: boolean;
  isSelf: boolean;
}

export interface InternTaskRow {
  _id: string;
  intern: PersonRef;
  mentor?: PersonRef | null;
  title: string;
  description?: string;
  kind: 'learning' | 'project';
  project?: { _id: string; code: string; name: string } | null;
  dueDate?: string | null;
  estimateHours?: number;
  status: 'assigned' | 'in_progress' | 'submitted' | 'approved' | 'redo';
  logs: { _id: string; date: string; minutes: number; note: string }[];
  reviews: { _id: string; outcome: string; rating?: number; note?: string; byName?: string; at: string }[];
  submittedNote?: string;
  assignedByName?: string;
  loggedMinutes: number;
  mine: boolean;
  canReview: boolean;
}

export const INTERN_STATUS_LABEL: Record<InternStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  completed: 'Completed',
  dropped: 'Dropped',
  converted: 'Hired as employee',
};
export const TASK_STATUS_LABEL: Record<InternTaskRow['status'], string> = {
  assigned: 'To do',
  in_progress: 'In progress',
  submitted: 'Submitted for review',
  approved: 'Approved',
  redo: 'Redo',
};
export const inr = (paise?: number) => (paise == null ? '—' : `₹${(paise / 100).toLocaleString('en-IN')}`);
export const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
