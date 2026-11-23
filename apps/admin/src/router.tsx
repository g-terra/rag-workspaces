import { createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/app-layout';
import { RequireAuth } from '@/components/require-auth';
import { AuthCallback } from '@/routes/auth-callback';
import { NotFound } from '@/routes/not-found';
import { RootRedirect } from '@/routes/root-redirect';
import { SignIn } from '@/routes/sign-in';
import { WorkspaceHome } from '@/routes/workspace-home';
import { WorkspaceLayout } from '@/routes/workspace-layout';
import { Documents } from '@/routes/documents';
import { Playground } from '@/routes/playground';
import { Upload } from '@/routes/upload';
import { Workspaces } from '@/routes/workspaces';

export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <RootRedirect /> },
          { path: 'workspaces', element: <Workspaces /> },
          {
            path: 'w/:slug',
            element: <WorkspaceLayout />,
            children: [
              { index: true, element: <WorkspaceHome /> },
              { path: 'upload', element: <Upload /> },
              { path: 'documents', element: <Documents /> },
              { path: 'playground', element: <Playground /> },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
