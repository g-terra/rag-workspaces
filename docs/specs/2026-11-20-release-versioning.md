---
title: Version the API from each release, shown in Swagger; publish Docker images on release
date: 2026-11-20
pr: '#23'
status: merged
areas: [ci, api]
---

# Version the API from each release, shown in Swagger; publish Docker images on release

## Summary

Each release-please release now sets the API's version (`apps/api/package.json`), which the API shows in
Swagger. When a release is created on `main`, a workflow job builds the API and admin images and pushes
them to GitHub's container registry, tagged `X.Y.Z`, `X.Y` and `latest`.

## Why

Commit rules and release-please landed in #25; these two pieces need the app code to exist.

## Design

1. `release-please-config.json`: `extra-files` lists `apps/api/package.json`.
2. `apps/api/src/version.ts`: reads the version from the API's `package.json`; `app.ts` uses it in the
   OpenAPI info.
3. `.github/workflows/release.yml`, job `images`: on a created release, build
   `docker/api.Dockerfile` and `docker/admin.Dockerfile`, push to `ghcr.io/g-terra/rag-workspaces-api`
   and `ghcr.io/g-terra/rag-workspaces-admin`; tags via `docker/metadata-action`. Permissions
   `contents: read, packages: write` on that job only.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| --- | --- | --- |
| One release version for tag, images and API | Version every package | Other packages are internal; nothing reads their version (they stay 0.0.0) |
| GitHub container registry | Docker Hub | No extra account; private while the repo is private |
| `packages: write` on the images job only | Workflow-wide | Least privilege |

## Interfaces and contracts

- **HTTP API**: OpenAPI `info.version` = the release version.
- **Configuration**: repository setting: the workflow token must allow write (Settings → Actions →
  General) for the images job.
- **Data**: None.
- **Langflow**: None.
- **Events and logs**: images `ghcr.io/g-terra/rag-workspaces-api` and `-admin`.

## Operations

A pushed image tag can be deleted, but anyone who pulled it keeps it. Compose still builds locally;
nothing pulls these images yet. The job first runs at the first real release.

## Testing

`apps/api/src/version.test.ts`: the API version matches `.release-please-manifest.json`. By hand: Swagger
header at http://localhost:3000/docs shows the version.

## Out of scope and follow-ups

Compose using the published images instead of local builds.

## Docs updated

`README.md` (release step mentions version and images).
