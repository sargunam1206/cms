/**
 * Optional sample data: a few clients and projects with tasks assigned to every active employee.
 * Safe to re-run (a project that already exists is skipped). Delete the SMP-* projects and clients to remove it.
 * Run: npx tsx --env-file=.env src/seed/sample-projects.ts
 */
import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { Employee } from '../modules/employees/model';
import { Client, Project, Task } from '../modules/projects/model';
import { User } from '../modules/users/model';

const CLIENTS = [
  { name: 'Sunrise Textiles', contactName: 'Anand Raj', email: 'anand@sunrise.example', phone: '9840012345' },
  { name: 'Coastal Logistics', contactName: 'Meena Iyer', email: 'meena@coastal.example', phone: '9841098765' },
];

const PROJECTS = [
  { code: 'SMP-001', name: 'Customer Portal', client: 'Sunrise Textiles', billingType: 'fixed', status: 'active', start: '2026-11-02', due: '2026-12-18', budget: 320, description: 'Self-service portal for orders, invoices and support tickets.' },
  { code: 'SMP-002', name: 'Fleet Tracking App', client: 'Coastal Logistics', billingType: 'time_material', status: 'active', start: '2026-11-09', due: '2027-01-15', budget: 480, description: 'Live vehicle tracking with trip reports and alerts.' },
  { code: 'SMP-003', name: 'Internal Knowledge Base', client: null, billingType: 'internal', status: 'planning', start: '2026-11-16', due: '2026-12-31', budget: 120, description: 'Searchable wiki for processes, onboarding and FAQs.' },
] as const;

type Status = 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
type Priority = 'low' | 'medium' | 'high' | 'urgent';
const TASKS: { project: number; title: string; description: string; status: Status; priority: Priority; hours: number; due: string }[] = [
  { project: 0, title: 'Design login and sign-up screens', description: 'Wireframes and final UI for authentication.', status: 'done', priority: 'high', hours: 8, due: '2026-11-13' },
  { project: 0, title: 'Build order history page', description: 'List, filter and export the customer orders.', status: 'in_progress', priority: 'high', hours: 16, due: '2026-11-24' },
  { project: 0, title: 'Invoice PDF download', description: 'Generate invoice PDFs with GST details.', status: 'todo', priority: 'medium', hours: 12, due: '2026-12-01' },
  { project: 0, title: 'Support ticket module', description: 'Raise, track and reply to tickets.', status: 'todo', priority: 'medium', hours: 24, due: '2026-12-08' },
  { project: 0, title: 'Review API security checklist', description: 'Check auth, rate limits and input validation.', status: 'in_review', priority: 'urgent', hours: 6, due: '2026-11-20' },
  { project: 1, title: 'Set up GPS device ingestion', description: 'Receive and store location pings from devices.', status: 'in_progress', priority: 'urgent', hours: 20, due: '2026-11-27' },
  { project: 1, title: 'Live map view', description: 'Show vehicles on a map with auto-refresh.', status: 'todo', priority: 'high', hours: 18, due: '2026-12-10' },
  { project: 1, title: 'Trip report export', description: 'Daily trip summary as Excel.', status: 'todo', priority: 'low', hours: 10, due: '2026-12-22' },
  { project: 1, title: 'Over-speed alert rules', description: 'Configurable thresholds and notifications.', status: 'blocked', priority: 'medium', hours: 14, due: '2026-12-15' },
  { project: 1, title: 'Driver mobile layout fixes', description: 'Fix layout issues on small screens.', status: 'in_review', priority: 'medium', hours: 6, due: '2026-11-25' },
  { project: 2, title: 'Define wiki structure', description: 'Categories, tags and page templates.', status: 'in_progress', priority: 'medium', hours: 6, due: '2026-11-23' },
  { project: 2, title: 'Write onboarding guide', description: 'First-week checklist for new joiners.', status: 'todo', priority: 'low', hours: 8, due: '2026-12-05' },
  { project: 2, title: 'Add search with filters', description: 'Full-text search across pages.', status: 'todo', priority: 'medium', hours: 12, due: '2026-12-18' },
  { project: 2, title: 'Migrate existing documents', description: 'Move shared-drive documents into the wiki.', status: 'todo', priority: 'low', hours: 16, due: '2026-12-29' },
];

async function main() {
  await connectDb(env.MONGO_URI);
  const employees = await Employee.find({ status: 'active' }).sort({ code: 1 });
  const admin = await User.findOne({ email: 'admin@company.local' });
  const lead = employees.find((e) => e.name === 'Pushpa') ?? employees[0];
  if (!lead || !employees.length) throw new Error('No active employees to assign to');

  const clients: Record<string, unknown> = {};
  for (const c of CLIENTS) clients[c.name] = (await Client.findOneAndUpdate({ name: c.name }, c, { upsert: true, new: true }))._id;

  const projects = [];
  for (const p of PROJECTS) {
    let doc = await Project.findOne({ code: p.code });
    if (!doc) {
      doc = await Project.create({
        code: p.code, name: p.name, client: p.client ? clients[p.client] : null, manager: lead._id, members: employees.map((e) => e._id),
        status: p.status, billingType: p.billingType, startDate: p.start, dueDate: p.due, budgetHours: p.budget, description: p.description, createdBy: admin?._id,
      });
      console.log(`created ${p.code} ${p.name}`);
      projects.push({ doc, fresh: true });
    } else projects.push({ doc, fresh: false });
  }

  // 3 tasks for each person, spread over the projects, so everyone has work in more than one project
  let made = 0;
  let n = 0;
  for (let i = 0; i < employees.length; i++) {
    for (let k = 0; k < 3; k++) {
      const t = TASKS[(i * 3 + k) % TASKS.length];
      const p = projects[t.project];
      if (!p.fresh) continue;
      const seq = await Project.findByIdAndUpdate(p.doc._id, { $inc: { taskSeq: 1 } }, { new: true });
      await Task.create({
        project: p.doc._id, number: seq!.taskSeq, title: t.title, description: t.description, assignee: employees[i]._id, reporter: admin?._id,
        status: t.status, priority: t.priority, estimateHours: t.hours, dueDate: t.due, position: n++, completedAt: t.status === 'done' ? new Date() : undefined,
      });
      made++;
    }
  }
  console.log(`tasks created: ${made} for ${employees.length} employees`);
  await disconnectDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
