import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Building2,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  KeyRound,
  UserCircle,
  Landmark,
  Wallet,
  Banknote,
  Receipt,
  ListPlus,
  Plane,
} from 'lucide-react';
import { PERMISSIONS as P, type Permission } from '@cms/shared';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChangePasswordDialog } from './ChangePasswordDialog';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  perms?: Permission[];
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Me',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/profile', label: 'My Profile', icon: UserCircle },
      { to: '/my/attendance', label: 'My Attendance', icon: CalendarCheck, perms: [P.ATTENDANCE_SELF] },
      { to: '/my/payslips', label: 'My Payslips', icon: Receipt },
      { to: '/my/leave', label: 'My Leave', icon: Plane, perms: [P.LEAVE_SELF] },
    ],
  },
  {
    section: 'Team',
    items: [
      { to: '/approvals', label: 'Approvals', icon: CheckSquare, perms: [P.LEAVE_APPROVE, P.REGULARIZATION_APPROVE] },
      { to: '/attendance/register', label: 'Attendance Register', icon: ClipboardList, perms: [P.ATTENDANCE_TEAM, P.ATTENDANCE_ALL] },
      { to: '/leave/admin', label: 'Leave Management', icon: CalendarDays, perms: [P.LEAVE_MANAGE] },
    ],
  },
  {
    section: 'Admin',
    items: [
      { to: '/employees', label: 'Employees', icon: Building2, perms: [P.EMPLOYEES_VIEW] },
      { to: '/profile-changes', label: 'Bank Changes', icon: Landmark, perms: [P.EMPLOYEES_MANAGE] },
      { to: '/payroll/runs', label: 'Payroll Runs', icon: Banknote, perms: [P.PAYROLL_VIEW, P.PAYROLL_MANAGE] },
      { to: '/payroll/adjustments', label: 'Payroll Adjustments', icon: ListPlus, perms: [P.PAYROLL_VIEW, P.PAYROLL_MANAGE] },
      { to: '/payroll/setup', label: 'Payroll Setup', icon: Wallet, perms: [P.PAYROLL_VIEW, P.PAYROLL_MANAGE] },
      { to: '/users', label: 'Users & Roles', icon: Users, perms: [P.USERS_MANAGE, P.ROLES_MANAGE] },
      { to: '/settings', label: 'Settings', icon: Settings, perms: [P.SETTINGS_MANAGE, P.HOLIDAYS_MANAGE, P.LEAVE_MANAGE] },
      { to: '/audit', label: 'Audit Log', icon: History, perms: [P.AUDIT_VIEW] },
    ],
  },
];

export function Layout() {
  const { user, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const sidebar = (
    <nav className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center gap-2 px-2 py-2 font-semibold">
        <ShieldCheck className="h-5 w-5 text-primary" /> CMS
      </div>
      {NAV.map(({ section, items }) => {
        const visible = items.filter((i) => !i.perms || can(...i.perms));
        if (!visible.length) return null;
        return (
          <div key={section}>
            <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{section}</div>
            {visible.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent',
                    isActive && 'bg-primary/10 font-medium text-primary',
                  )
                }
              >
                <Icon className="h-4 w-4" /> {label}
              </NavLink>
            ))}
          </div>
        );
      })}
      <div className="mt-auto border-t pt-3">
        <div className="px-2 text-sm font-medium">{user?.employee?.name ?? user?.email}</div>
        <div className="px-2 pb-2 text-xs text-muted-foreground">{user?.role}</div>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setPwOpen(true)}>
          <KeyRound /> Change password
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={logout}>
          <LogOut /> Sign out
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-background md:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside className="absolute left-0 top-0 h-full w-64 bg-background" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center border-b bg-background px-4 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <span className="ml-2 font-semibold">CMS</span>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}
