export type ToolLink = { name: string; description: string; href: string };

/**
 * The stack's own tools, as the browser reaches them. The URLs are baked in at build time
 * (`VITE_LANGFLOW_URL`, `VITE_KEYCLOAK_URL`); Swagger goes through this UI's own `/api/` proxy.
 */
export function toolLinks(urls: { langflow: string; keycloak: string }): ToolLink[] {
  const base = (url: string) => url.replace(/\/+$/, '');
  return [
    {
      name: 'Langflow',
      description: 'The flow editor: ingest, retrieve, answer and chat flows',
      href: `${base(urls.langflow)}/`,
    },
    {
      name: 'Keycloak',
      description:
        'Admin console for people, passwords and roles. Sign in with KEYCLOAK_ADMIN from .env, not your app login',
      href: `${base(urls.keycloak)}/admin/master/console/#/rag-workspaces`,
    },
    {
      name: 'API docs',
      description: 'Swagger: every route, its shapes, and a way to try it',
      href: '/api/docs/',
    },
  ];
}
