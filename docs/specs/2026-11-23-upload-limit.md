---
title: raise the upload limit to 2 GB and make it one setting
date: 2026-11-23
pr: "#70"
status: in review
areas: [api, admin, infra, docs]
---

# Raise the upload limit to 2 GB and make it one setting

## Summary

`MAX_UPLOAD_BYTES` is one `.env` setting, default 2 GB (2147483648 bytes), read in two places:

- The API's multipart limit.
- The admin UI's nginx, as `client_max_body_size`. Before, this was hard-coded to `200m`.

nginx now passes uploads straight to the API instead of writing them to a temp file first. A `413` says the
limit in words ("is larger than the upload limit of 2 GB"), and the admin UI shows that message. The
UI's own early check moves to 2 GB.

## Why

Guilherme asked for the limit to be raised for video (2026-11-23). docs/architecture.md planned 2 GB for
video, and his lecture recordings are larger than 200 MB. The limit lived in three places that had to be
kept in step by hand: `apps/api/src/config.ts`, `docker/admin/nginx.conf` and
`apps/admin/src/documents/files.ts`.

## Design

1. **API** (`apps/api/src/config.ts`): the default for `MAX_UPLOAD_BYTES` is now `2 * 1024 ** 3`. The
   `413` detail uses a readable size (`formatBytes` in `routes/documents.ts`).
2. **nginx**:
   - `docker/admin/nginx.conf` becomes `nginx.conf.template`, copied to `/etc/nginx/templates/`. The
     official nginx image runs `envsubst` on it at start, for variables that are set in the environment
     only, so `$host` and `$uri` stay as they are.
   - The template has `client_max_body_size ${MAX_UPLOAD_BYTES};`.
   - The Dockerfile sets `ENV MAX_UPLOAD_BYTES=2147483648` as the default.
   - It adds `proxy_request_buffering off` on `/api/`, so a 2 GB upload isn't written to disk twice.
3. **Compose**: `MAX_UPLOAD_BYTES: ${MAX_UPLOAD_BYTES:-2147483648}` on both `api` and `web`. It is
   documented in `.env.example`.
4. **Admin UI** (`files.ts`): the early check uses 2 GB. On a `413`, the UI shows the API's detail, so a
   lower limit set on the server shows its real value. The upload screen says "up to 2 GB each".

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| One env value for API and nginx | Separate settings | They must agree; one value can't drift |
| nginx template (the image's built-in envsubst) | A custom entrypoint script | Built into `nginx:alpine`, no new files to maintain, and nginx's own `$variables` are left alone |
| The UI keeps a 2 GB constant for its early check | Read the limit from the API | The API's 413 message already gives the real limit; a new route only for this isn't needed yet |
| `proxy_request_buffering off` | Keep buffering | Buffering would write each 2 GB upload to a temp file inside the web container before sending it on |
| 2 GB, not unlimited | No limit | A typo'd drag of a disk image should still be refused; video fits |

## Interfaces and contracts

- **HTTP API**: the `413` `detail` reads `"<name>" is larger than the upload limit of 2 GB.` The status is
  unchanged.
- **Configuration**: `MAX_UPLOAD_BYTES` (bytes, default `2147483648`) is now passed by compose to `api`
  and `web`.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: None.

## Operations

Rebuild the admin UI image once (`docker compose up -d --build`), since the nginx config moved to a
template. To change the limit, set `MAX_UPLOAD_BYTES` in `.env` and run `docker compose up -d`.

## Testing

- `apps/api/src/routes/documents.test.ts`: the `413` detail names the limit ("195 KB" for the test's
  200000 bytes).
- `apps/admin/src/documents/files.test.ts`: the 2 GB boundary, and a `413` shows the server's words. Both
  tests failed before the change.
- By hand:
  - The rebuilt web image rendered `client_max_body_size 524288000;` from `MAX_UPLOAD_BYTES=524288000`,
    kept `$host` and `$uri`, and `nginx -t` passed.
  - On the smoke stack, a 300 MB file through the admin UI's nginx (`:18080/api`) reached the API, which
    answered 415 for its content rather than nginx answering 413.
  - `pnpm smoke` passed.

## Out of scope and follow-ups

- Resumable or chunked uploads for very large files.

## Docs updated

- `.env.example`, `docs/setup.md`, `docs/architecture.md` ("Limits at the door"), and
  `docs/api-schema.md` (documents).
