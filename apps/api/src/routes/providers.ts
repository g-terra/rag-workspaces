import type { Database } from '@rag/db';
import { ModelProviderId, SetProviderKey, WorkspaceProvider, WorkspaceSlug } from '@rag/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireWorkspace } from '../auth/access.js';
import type { Config } from '../config.js';
import { HttpProblem } from '../errors.js';
import {
  removeProviderKey,
  saveProviderKey,
  workspaceProviders,
  type KeyConfig,
} from '../services/provider-keys.js';

export type ProviderRoutesOptions = {
  db: Database;
  config: KeyConfig & Pick<Config, 'READY_TIMEOUT_MS'>;
  /** How provider model lists are fetched; tests pass a stand-in. */
  fetchFn: typeof fetch;
};

const SlugParams = z.object({ slug: WorkspaceSlug });
const ProviderParams = SlugParams.extend({ provider: ModelProviderId });
const common = { tags: ['workspaces'], security: [{ bearerAuth: [] }] };

/**
 * Model provider keys saved per workspace (admins only). They win over the keys in `.env` for that
 * workspace's flows, are stored encrypted, and are never returned: only their last four characters.
 */
export const providerRoutes: FastifyPluginAsyncZod<ProviderRoutesOptions> = async (
  app,
  { db, config, fetchFn },
) => {
  const signal = () => AbortSignal.timeout(config.READY_TIMEOUT_MS);
  const list = (workspaceId: string) => workspaceProviders(db, config, workspaceId, fetchFn, signal());

  app.get(
    '/v1/workspaces/:slug/providers',
    {
      schema: {
        ...common,
        summary: "The model providers as this workspace sees them, with each one's models (admins only)",
        description:
          'Each provider is asked for its models with the key this workspace would use: its own saved key, ' +
          'else the one in `.env`. `key.source` says which (`null`: none). Keys are never returned, only ' +
          'the last four characters of a saved one.',
        params: SlugParams,
        response: { 200: z.array(WorkspaceProvider) },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      return list(workspace.id);
    },
  );

  app.put(
    '/v1/workspaces/:slug/providers/:provider/key',
    {
      schema: {
        ...common,
        summary: 'Save a hosted provider API key for this workspace (admins only)',
        description:
          'The key is checked by asking the provider for its models, then stored encrypted (AES-256-GCM ' +
          "under `SECRETS_KEY`) and used instead of `.env`'s key for this workspace. `422` when the " +
          'provider refuses it, `502` or `504` when it fails or is too slow to answer (nothing is saved ' +
          'either way), `400` for `lmstudio`, `503` when `SECRETS_KEY` is not set.',
        params: ProviderParams,
        body: SetProviderKey,
        response: { 200: WorkspaceProvider },
      },
    },
    async (req) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      const saved = await saveProviderKey(
        db,
        config,
        {
          workspaceId: workspace.id,
          provider: req.params.provider,
          apiKey: req.body.apiKey,
          savedBy: req.principal!.id,
        },
        fetchFn,
        signal(),
      );
      // Logged without the key, of course.
      req.log.info(
        { workspace: workspace.slug, provider: req.params.provider, by: req.principal?.id },
        'provider key saved',
      );
      return saved;
    },
  );

  app.delete(
    '/v1/workspaces/:slug/providers/:provider/key',
    {
      schema: {
        ...common,
        summary: "Remove this workspace's saved key for a provider (admins only)",
        description:
          'The workspace goes back to the key in `.env`, if there is one. `404` when none was saved.',
        params: ProviderParams,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { workspace } = await requireWorkspace(db, req.principal, req.params.slug, 'admin');
      if (!(await removeProviderKey(db, workspace.id, req.params.provider))) {
        throw new HttpProblem(404, `No ${req.params.provider} key is saved for "${workspace.slug}".`);
      }
      req.log.info(
        { workspace: workspace.slug, provider: req.params.provider, by: req.principal?.id },
        'provider key removed',
      );
      return reply.status(204).send(null);
    },
  );
};
