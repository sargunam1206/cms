import dayjs from 'dayjs';
import { todayStr } from '../../utils/time';
import { notify, usersOfEmployees } from '../notifications/service';
import { Project, Task } from './model';

/**
 * Remind assignees about open tasks due today or tomorrow. Safe to run more than once a day: a person who still has
 * an unread reminder for the same task and due date is not reminded again.
 */
export async function notifyDueSoon(today = todayStr()) {
  const tomorrow = dayjs(today).add(1, 'day').format('YYYY-MM-DD');
  const tasks = await Task.find({ status: { $ne: 'done' }, assignee: { $ne: null }, dueDate: { $gte: today, $lte: tomorrow } })
    .select('number title dueDate assignee project')
    .lean();
  if (!tasks.length) return 0;
  const projects = new Map((await Project.find({ _id: { $in: tasks.map((t) => t.project) }, status: { $in: ['planning', 'active', 'on_hold'] } }).select('code').lean()).map((p) => [String(p._id), p]));
  let sent = 0;
  for (const t of tasks) {
    const p = projects.get(String(t.project));
    if (!p) continue; // closed projects do not nag
    await notify({
      type: 'task.due_soon',
      to: await usersOfEmployees([t.assignee]),
      title: `${p.code}-${t.number} is due ${t.dueDate === today ? 'today' : 'tomorrow'}`,
      body: t.title,
      link: `/projects/${p._id}`,
      entity: { kind: 'Task', id: t._id },
      dedupeKey: `${t._id}:${t.dueDate}`,
    });
    sent++;
  }
  return sent;
}
