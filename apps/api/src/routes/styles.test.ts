import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../app.js';
import type { Authenticator } from '../auth/principal.js';
import { keycloakAuthenticator } from '../auth/keycloak.js';
import { loadConfig } from '../config.js';
import { testKeycloak } from '../test/tokens.js';

/** A reader API key, standing in for apiKeyAuthenticator (no database here). */
const readerKey: Authenticator = async (credential) =>
  credential === 'rw_test'
    ? { kind: 'key', id: 'key_1', name: 'agent', role: 'reader', workspaces: [] }
    : null;

describe('GET /v1/styles', () => {
  let app: App;
  let kc: Awaited<ReturnType<typeof testKeycloak>>;

  beforeAll(async () => {
    kc = await testKeycloak();
    app = await buildApp({
      config: loadConfig({ NODE_ENV: 'test' }),
      logger: false,
      authenticators: [readerKey, keycloakAuthenticator(kc.options)],
    });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('lists the built-in styles to a signed-in person', async () => {
    const res = await app.inject({
      url: '/v1/styles',
      headers: { authorization: `Bearer ${await kc.token({ sub: 'reader-1' })}` },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.map((s: { slug: string }) => s.slug)).toEqual(['academic', 'talkative', 'concise', 'tutor']);
    expect(data[0]).toMatchObject({ slug: 'academic', name: 'Academic', builtIn: true });
    expect(data[0].instructions).toContain('formal');
  });

  it('lists them to an API key too, so agents can choose one', async () => {
    const res = await app.inject({ url: '/v1/styles', headers: { authorization: 'Bearer rw_test' } });
    expect(res.statusCode).toBe(200);
  });

  it('needs a signed-in caller', async () => {
    expect((await app.inject({ url: '/v1/styles' })).statusCode).toBe(401);
  });
});
