# User guide

How to use and configure rag-workspaces once it is running. If it isn't yet, start with
[Setup](../setup.md).

| Page | Read it to |
|---|---|
| [Workspaces](workspaces.md) | Create a workspace, change its model and retrieval settings, give people access, reindex or delete it |
| [Adding material](adding-material.md) | Upload files, follow them through ingestion, and manage the document library |
| [Playground and conversations](playground.md) | Ask a workspace a question, search its passages, chat, and read past conversations |
| [API keys and agents](api-keys.md) | Let a script or an AI agent use a workspace, over the REST API or MCP |
| [Models and providers](providers.md) | Run on LM Studio or a hosted provider, and save a provider key for one workspace |
| [Usage analytics](usage.md) | See who asks what, how fast answers come, and which documents get cited |
| [Configuration reference](configuration.md) | Every setting in `.env`, with its default |
| [Tuning answer quality](../tuning.md) | Measure answers and pick settings that work for local models |

For scripts calling the API directly there is [Using the API](../api.md), and every route is in the
[API schema](../api-schema.md) and the live Swagger UI at http://api.rag.localhost/docs.

The screenshots come from a throwaway test stack (`pnpm smoke --keep`) with sample material and a stand-in
model, so the answers in them are canned replies that start with `[stand-in …]`, and the System page flags
the stand-in's missing chat model. A real model writes real answers in the same places.

## Getting around

The first time you sign in, in each browser, a short walkthrough points out the workspace switcher and each
page in the sidebar. The `?` Help button at the bottom of the sidebar replays it and links to the API docs.

## Who can do what

Everyone signs in through Keycloak. There is one global role, **admin**. Inside a workspace, each person
and each API key is a **reader** or an **editor**.

| | Reader | Editor | Admin |
|---|---|---|---|
| Ask, search, chat; read their own conversations | yes | yes | yes |
| Download documents | yes | yes | yes |
| Upload, reindex and delete documents | | yes | yes |
| See the workspace's usage | | yes | yes |
| Create workspaces, change settings, manage members | | | yes |
| Create API keys, manage response styles, see usage across all workspaces, see the System page | | | yes |

Answers and conversations are private to the person or key that asked, plus admins.
