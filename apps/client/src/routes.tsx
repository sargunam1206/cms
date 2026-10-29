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
        <Route path="my/payslips" element={<MyPayslipsPage />} />
        <Route path="payroll/runs" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><PayrollRunsPage /></Guard>} />
        <Route path="payroll/runs/:id" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><PayrollRunPage /></Guard>} />
        <Route path="payroll/adjustments" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><AdjustmentsPage /></Guard>} />
        <Route path="payroll/setup" element={<Guard perms={[P.PAYROLL_VIEW, P.PAYROLL_MANAGE]}><PayrollSetupPage /></Guard>} />
        <Route path="users" element={<Guard perms={[P.USERS_MANAGE, P.ROLES_MANAGE]}><UsersRolesPage /></Guard>} />
        <Route path="settings" element={<Guard perms={[P.SETTINGS_MANAGE, P.HOLIDAYS_MANAGE, P.LEAVE_MANAGE]}><SettingsPage /></Guard>} />
        <Route path="audit" element={<Guard perms={[P.AUDIT_VIEW]}><AuditPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
