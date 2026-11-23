import { AlertTriangle } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { useSystem } from '@/system/queries';
import { firstProblem } from '@/system/status';

/**
 * Above every page, for admins: one line when something the API depends on is down, naming it and
 * what to do next. Most often LM Studio is not running, which otherwise shows up as an answer that
 * fails with no visible cause (Workstream 2, item 9).
 *
 * It says nothing when `GET /v1/system` itself fails: that call is not the point of the page a
 * person is on, and the pages that need it report their own failures. It also says nothing on the
 * System page, which shows the same problem in its own words right below.
 */
export function SystemBanner() {
  const { me } = useAuth();
  const onSystemPage = useLocation().pathname === '/system';
  const system = useSystem(me?.isAdmin === true);
  const problem = system.data ? firstProblem(system.data) : null;
  if (!problem || onSystemPage) return null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <AlertTriangle className="size-4 flex-none" aria-hidden />
      <span className="font-medium">{problem.what}.</span>
      <span>{problem.fix}</span>
      <Link to="/system" className="ml-auto underline underline-offset-2">
        System
      </Link>
    </div>
  );
}
