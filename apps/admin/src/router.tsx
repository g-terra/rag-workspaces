import { createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/app-layout';
import { RequireAuth } from '@/components/require-auth';
import { AuthCallback } from '@/routes/auth-callback';
import { Home } from '@/routes/home';
import { SignIn } from '@/routes/sign-in';

export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  {
    element: <RequireAuth />,
    children: [{ element: <AppLayout />, children: [{ index: true, element: <Home /> }] }],
  },
]);
