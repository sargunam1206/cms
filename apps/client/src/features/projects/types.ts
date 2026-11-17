import type { EmployeeRef } from '@/api/types';

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface ClientRow {
  _id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  gstin?: string;
  notes?: string;
  active: boolean;
}

export interface Stats {
  total: number;
  done: number;
  overdue: number;
  estimateHours: number;
}

export interface ProjectRow {
  _id: string;
  code: string;
  name: string;
  client?: { _id: string; name: string } | null;
  manager: EmployeeRef;
  status: ProjectStatus;
  billingType: 'fixed' | 'time_material' | 'internal';
  startDate?: string;
  dueDate?: string;
  stats: Stats;
}

export interface ProjectDetail extends Omit<ProjectRow, 'client' | 'stats'> {
  client?: ClientRow | null;
  members: EmployeeRef[];
  budgetHours?: number;
  description?: string;
  stats: Stats & { byStatus: Record<TaskStatus, number> };
  canManage: boolean;
}

export interface TaskComment {
  _id: string;
  byName: string;
  text: string;
  at: string;
}

export interface TaskRow {
  _id: string;
  ref: string;
  number: number;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee?: EmployeeRef | null;
  estimateHours?: number;
  dueDate?: string;
  milestone?: string | null;
  estimateModule?: string | null;
  position: number;
  project?: { _id: string; code: string; name: string; status?: string };
  comments?: TaskComment[];
  canManage?: boolean;
  isAssignee?: boolean;
}

export interface Person extends EmployeeRef {
  department?: string;
  designation?: string;
}

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'in_review', label: 'In review' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];
export const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];
export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
export const BILLING = [
  { value: 'time_material', label: 'Time and material' },
  { value: 'fixed', label: 'Fixed price' },
  { value: 'internal', label: 'Internal' },
];

export const statusLabel = (s: string) => TASK_STATUSES.find((x) => x.value === s)?.label ?? s;
export const priorityLabel = (p: string) => PRIORITIES.find((x) => x.value === p)?.label ?? p;
export const projectStatusLabel = (s: string) => PROJECT_STATUSES.find((x) => x.value === s)?.label ?? s;

export const isOverdue = (t: { dueDate?: string; status: string }, today: string) => !!t.dueDate && t.status !== 'done' && t.dueDate < today;
