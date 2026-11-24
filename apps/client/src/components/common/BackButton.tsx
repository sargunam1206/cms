import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

/** Where "Back" goes when there is no earlier page in this tab (opened from a link, a notification or a refresh). */
function parentOf(path: string, isIntern: boolean): string {
  const p = path.replace(/\/+$/, '');
  if (/^\/attendance\/employee\/[^/]+$/.test(p)) return '/attendance/register';
  if (/^\/interns\/[^/]+$/.test(p)) return isIntern ? '/intern-work' : '/interns';
  // a record page goes to its list: /projects/123 -> /projects, /payroll/runs/123 -> /payroll/runs
  const detail = p.match(/^(\/(?:projects|ideas|meetings|enquiries|payroll\/runs))\/[^/]+$/);
  if (detail) return detail[1];
  return '/';
}

/** A Back button shown above every page except the dashboard. */
export function BackButton() {
  const { pathname, key } = useLocation();
  const nav = useNavigate();
  const { user } = useAuth();
  if (pathname === '/' || pathname === '') return null;
  // "default" is the first page loaded in this tab: there is nothing in-app to go back to
  const hasHistory = key !== 'default';
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 mb-2 h-8 gap-1 px-2 text-muted-foreground hover:text-foreground"
      onClick={() => (hasHistory ? nav(-1) : nav(parentOf(pathname, user?.employee?.type === 'intern')))}
    >
      <ArrowLeft className="h-4 w-4" /> Back
    </Button>
  );
}
