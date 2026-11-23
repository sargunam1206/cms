import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PERMISSIONS as P, type Permission } from '@cms/shared';
import { useAuth } from '@/lib/auth';
import { Layout } from '@/components/common/Layout';
import { Spinner } from '@/components/common/page';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/PasswordResetPages';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { FnFPage } from '@/features/payroll/FnFPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { MyTimesheetPage } from '@/features/timesheets/MyTimesheetPage';
import { TimesheetApprovalsPage } from '@/features/timesheets/TimesheetApprovalsPage';
import { IdeaPage } from '@/features/ideas/IdeaPage';
import { IdeasPage } from '@/features/ideas/IdeasPage';
import { MeetingPage } from '@/features/meetings/MeetingPage';
import { ConfidentialPage } from '@/features/confidential/ConfidentialPage';
import { TrackerPage } from '@/features/projects/TrackerPage';
import { InternPage } from '@/features/interns/InternPage';
import { InternsPage } from '@/features/interns/InternsPage';
import { InternWorkPage } from '@/features/interns/InternWorkPage';
import { MeetingsPage } from '@/features/meetings/MeetingsPage';
import { EnquiriesPage } from '@/features/enquiries/EnquiriesPage';
import { EnquiryPage } from '@/features/enquiries/EnquiryPage';
import { EstimateReportPage } from '@/features/estimates/EstimateReportPage';
import { PortfolioTimelinePage } from '@/features/estimates/PortfolioTimelinePage';
import { ClientsPage } from '@/features/projects/ClientsPage';
import { MyTasksPage } from '@/features/projects/MyTasksPage';
import { ProjectPage } from '@/features/projects/ProjectPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { AdjustmentsPage } from '@/features/payroll/AdjustmentsPage';
import { MyPayslipsPage } from '@/features/payroll/MyPayslipsPage';
import { PayrollRunPage, PayrollRunsPage } from '@/features/payroll/PayrollRunsPage';
import { PayrollSetupPage } from '@/features/payroll/PayrollSetupPage';
import { BankChangesPage } from '@/features/profile/BankChangesPage';
import { MyAttendancePage } from '@/features/attendance/MyAttendancePage';
import { RegisterPage } from '@/features/attendance/RegisterPage';
import { EmployeeAttendancePage } from '@/features/attendance/EmployeeAttendancePage';
import { MyLeavePage } from '@/features/leave/MyLeavePage';
import { LeaveAdminPage } from '@/features/leave/LeaveAdminPage';
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage';
import { EmployeesPage } from '@/features/employees/EmployeesPage';
import { UsersRolesPage } from '@/features/users/UsersRolesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AuditPage } from '@/features/audit/AuditPage';

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Guard({ perms, children }: { perms: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...perms)) return <div className="py-20 text-center text-muted-foreground">You don't have access to this page.</div>;
  return <>{children}</>;
}

export function AppRoutes() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/login" element={!loading && user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="my/attendance" element={<Guard perms={[P.ATTENDANCE_SELF]}><MyAttendancePage /></Guard>} />
        <Route path="my/leave" element={<Guard perms={[P.LEAVE_SELF]}><MyLeavePage /></Guard>} />
        <Route path="approvals" element={<Guard perms={[P.LEAVE_APPROVE, P.REGULARIZATION_APPROVE]}><ApprovalsPage /></Guard>} />
        <Route path="attendance/register" element={<Guard perms={[P.ATTENDANCE_TEAM, P.ATTENDANCE_ALL]}><RegisterPage /></Guard>} />
        <Route path="attendance/employee/:id" element={<Guard perms={[P.ATTENDANCE_TEAM, P.ATTENDANCE_ALL]}><EmployeeAttendancePage /></Guard>} />
        <Route path="leave/admin" element={<Guard perms={[P.LEAVE_MANAGE]}><LeaveAdminPage /></Guard>} />
        <Route path="employees" element={<Guard perms={[P.EMPLOYEES_VIEW]}><EmployeesPage /></Guard>} />
        <Route path="profile-changes" element={<Guard perms={[P.EMPLOYEES_MANAGE]}><BankChangesPage /></Guard>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="my/timesheet" element={<Guard perms={[P.TASKS_SELF]}><MyTimesheetPage /></Guard>} />
        <Route path="timesheets/approvals" element={<Guard perms={[P.LEAVE_APPROVE, P.ATTENDANCE_ALL]}><TimesheetApprovalsPage /></Guard>} />
        <Route path="my/tasks" element={<Guard perms={[P.TASKS_SELF]}><MyTasksPage /></Guard>} />
        <Route path="projects" element={<Guard perms={[P.TASKS_SELF, P.PROJECTS_VIEW, P.PROJECTS_MANAGE]}><ProjectsPage /></Guard>} />
        <Route path="projects/:id" element={<Guard perms={[P.TASKS_SELF, P.PROJECTS_VIEW, P.PROJECTS_MANAGE]}><ProjectPage /></Guard>} />
        <Route path="estimates/report" element={<Guard perms={[P.ESTIMATES_VIEW]}><EstimateReportPage /></Guard>} />
        <Route path="timelines" element={<Guard perms={[P.PROJECTS_VIEW]}><PortfolioTimelinePage /></Guard>} />
        <Route path="ideas" element={<Guard perms={[P.IDEAS_SELF, P.IDEAS_MANAGE]}><IdeasPage /></Guard>} />
        <Route path="ideas/:id" element={<Guard perms={[P.IDEAS_SELF, P.IDEAS_MANAGE]}><IdeaPage /></Guard>} />
        <Route path="meetings" element={<Guard perms={[P.MEETINGS_SELF, P.MEETINGS_MANAGE]}><MeetingsPage /></Guard>} />
        <Route path="meetings/:id" element={<Guard perms={[P.MEETINGS_SELF, P.MEETINGS_MANAGE]}><MeetingPage /></Guard>} />
        <Route path="interns" element={<Guard perms={[P.INTERNS_MANAGE, P.INTERNS_MENTOR]}><InternsPage /></Guard>} />
        <Route path="interns/:id" element={<Guard perms={[P.INTERNS_MANAGE, P.INTERNS_MENTOR, P.INTERN_SELF]}><InternPage /></Guard>} />
        <Route path="intern-work" element={<Guard perms={[P.INTERN_SELF, P.INTERNS_MENTOR, P.INTERNS_MANAGE]}><InternWorkPage /></Guard>} />
        <Route path="tracker" element={<Guard perms={[P.PROJECTS_VIEW]}><TrackerPage /></Guard>} />
        <Route path="confidential" element={<Guard perms={[P.CONFIDENTIAL_VIEW, P.CONFIDENTIAL_MANAGE]}><ConfidentialPage /></Guard>} />
        <Route path="enquiries" element={<Guard perms={[P.ENQUIRIES_SELF, P.ENQUIRIES_VIEW, P.ENQUIRIES_MANAGE]}><EnquiriesPage /></Guard>} />
        <Route path="enquiries/:id" element={<Guard perms={[P.ENQUIRIES_SELF, P.ENQUIRIES_VIEW, P.ENQUIRIES_MANAGE]}><EnquiryPage /></Guard>} />
        <Route path="clients" element={<Guard perms={[P.PROJECTS_MANAGE, P.PROJECTS_VIEW]}><ClientsPage /></Guard>} />
        <Route path="my/payslips" element={<MyPayslipsPage />} />
        <Route path="payroll/runs" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><PayrollRunsPage /></Guard>} />
        <Route path="payroll/runs/:id" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><PayrollRunPage /></Guard>} />
        <Route path="payroll/adjustments" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><AdjustmentsPage /></Guard>} />
        <Route path="payroll/fnf" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><FnFPage /></Guard>} />
        <Route path="payroll/setup" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><PayrollSetupPage /></Guard>} />
        <Route path="users" element={<Guard perms={[P.USERS_MANAGE, P.ROLES_MANAGE]}><UsersRolesPage /></Guard>} />
        <Route path="settings" element={<Guard perms={[P.SETTINGS_MANAGE, P.HOLIDAYS_MANAGE, P.LEAVE_MANAGE, P.ESTIMATES_VIEW, P.ENQUIRIES_MANAGE]}><SettingsPage /></Guard>} />
        <Route path="audit" element={<Guard perms={[P.AUDIT_VIEW]}><AuditPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
