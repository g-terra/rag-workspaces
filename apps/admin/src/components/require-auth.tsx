import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/auth/auth-context';

/** Renders the signed-in part of the app, or sends the visitor to sign in and back here afterwards. */
export function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return null;
  if (!user) {
    const returnTo = location.pathname + location.search;
    return <Navigate to={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <Outlet />;
}
