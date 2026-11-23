import { describe, expect, it } from 'vitest';
import { toolLinks } from './tools';

describe('toolLinks', () => {
  it('links the Langflow editor, the Keycloak console for our realm and the Swagger docs', () => {
    const links = toolLinks({
      langflow: 'http://langflow.rag.localhost',
      keycloak: 'http://auth.rag.localhost',
    });
    expect(links.map((l) => [l.name, l.href])).toEqual([
      ['Langflow', 'http://langflow.rag.localhost/'],
      ['Keycloak', 'http://auth.rag.localhost/admin/master/console/#/rag-workspaces'],
      ['API docs', '/api/docs/'],
    ]);
    for (const link of links) expect(link.description).not.toBe('');
  });

  it('does not double a trailing slash', () => {
    const links = toolLinks({ langflow: 'http://localhost:7860/', keycloak: 'http://localhost:8081/' });
    expect(links[0]!.href).toBe('http://localhost:7860/');
    expect(links[1]!.href).toBe('http://localhost:8081/admin/master/console/#/rag-workspaces');
  });
});
