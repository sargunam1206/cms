import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/routes';
import { usersRouter, rolesRouter } from './modules/users/routes';
import { employeesRouter } from './modules/employees/routes';
import { settingsRouter } from './modules/settings/routes';
import { holidaysRouter } from './modules/holidays/routes';
import { auditRouter } from './modules/audit/routes';
import { attendanceRouter, regularizationRouter } from './modules/attendance/routes';
import { leaveRouter } from './modules/leave/routes';
import { companyRouter } from './modules/company/routes';
import { payrollRouter } from './modules/payroll/routes';
import { ideasRouter } from './modules/ideas/routes';
import { enquiriesRouter } from './modules/enquiries/routes';
import { estimatesRouter } from './modules/estimates/routes';
import { milestonesRouter } from './modules/milestones/routes';
import { taskFilesRouter } from './modules/projects/files';
import { projectsRouter } from './modules/projects/routes';
import { timesheetsRouter } from './modules/timesheets/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { profileRouter } from './modules/profile/routes';
import { dashboardRouter } from './modules/dashboard/routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date() }));
  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(authenticate);
  api.use('/users', usersRouter);
  api.use('/roles', rolesRouter);
  api.use('/employees', employeesRouter);
  api.use('/settings', settingsRouter);
  api.use('/holidays', holidaysRouter);
  api.use('/audit', auditRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/regularizations', regularizationRouter);
  api.use('/leave', leaveRouter);
  api.use('/profile', profileRouter);
  api.use('/payroll', payrollRouter);
  api.use('/projects', taskFilesRouter); // task attachments (before the projects router so its /:id routes do not catch these)
  api.use('/projects', projectsRouter);
  api.use('/estimates', estimatesRouter);
  api.use('/enquiries', enquiriesRouter);
  api.use('/ideas', ideasRouter);
  api.use('/milestones', milestonesRouter);
  api.use('/timesheets', timesheetsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/company', companyRouter);
  api.use('/dashboard', dashboardRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
