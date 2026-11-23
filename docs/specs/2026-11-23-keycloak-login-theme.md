---
title: style Keycloak's sign-in page like the admin UI
date: 2026-11-23
pr: "#104"
status: in review
areas: [infra]
---

# Style Keycloak's sign-in page like the admin UI

## Summary

People who press "Continue with Keycloak" now land on a sign-in page that looks like the admin UI: the same
dark brand panel with the logo and pitch on the left, and a plain form on the right in the shadcn/ui neutral
colours, type, radii and buttons, in light and dark mode. It is a Keycloak login theme kept in the repo
(`docker/keycloak/themes/rag-workspaces`), mounted by compose and chosen in `realm.json`, so a new install
gets it without any step.

## Why

The owner asked for the Keycloak login page to look more like the app (2026-11-23). Until now the admin UI's
own sign-in page (`apps/admin/src/routes/sign-in.tsx`, from the approved design mocks) handed over to
Keycloak's stock page, with its own logo, blue buttons and grey background, which read as a different
product. Keycloak stays the login service (docs/decisions.md #8); only its look changes.

## Design

- `docker/keycloak/themes/rag-workspaces/login/theme.properties`: a login theme whose parent is Keycloak's
  built-in `keycloak.v2` (PatternFly 5). Every page, form and flow comes from the parent; this theme only
  replaces the stylesheet (`styles=css/rag-workspaces.css`).
- `resources/css/rag-workspaces.css`: maps the admin UI's tokens (`apps/admin/src/index.css`) onto
  PatternFly's variables, and lays the page out like `sign-in.tsx`: `.pf-v5-c-login__header` becomes the
  zinc-900 panel (420px, wraps above the form on narrow screens), `.pf-v5-c-login__main` the 360px form
  column without a card. Inputs, the password toggle, buttons, the checkbox and alerts are restyled as
  shadcn's Input, Button (default and outline) and error box. Dark mode follows the system: keycloak.v2
  already adds `pf-v5-theme-dark` from `prefers-color-scheme`, as the admin UI's `main.tsx` does.
- `messages/messages_en.properties`: `loginTitleHtml` (the header Keycloak renders above every page) carries
  the brand, the pitch and "Admin console", in the same words as `sign-in.tsx`. `loginAccountTitle` is
  "Sign in" and `doLogIn` "Sign in", as in the admin UI. `rwNoAccount` is the "No account?" note.
- `footer.ftl`: keycloak.v2's documented footer extension point, showing `rwNoAccount` on the
  sign-in pages (`pageId` `login`, `login-username`, `login-password`) while self-registration is off.
- `resources/img/layers.svg`: lucide's `Layers` icon, the admin UI's logo.
- `docker-compose.yml` mounts the theme read-only at `/opt/keycloak/themes/rag-workspaces`;
  `docker/keycloak/realm.json` sets `"loginTheme": "rag-workspaces"`.

The master realm (Keycloak's own admin console) keeps the stock theme.

## Decisions and trade-offs

| Decision | Alternatives considered | Why this one |
| -------- | ----------------------- | ------------ |
| Extend `keycloak.v2` with a stylesheet, messages and the footer hook | Keycloakify (React + a build that packages a theme JAR); copying and editing keycloak.v2's `template.ftl` | No build step, no new dependency, and Keycloak's markup is untouched, so every page (login, OTP, password update, errors) keeps working across Keycloak upgrades. Keycloakify would add a package and a JAR build for one page; a copied `template.ftl` drifts from Keycloak's |
| Choose the theme in `realm.json` (`loginTheme`) | `KC_SPI_THEME__DEFAULT=rag-workspaces` | The SPI default is used for every theme type, so the admin console (which this theme doesn't provide) broke in testing |
| Brand panel text in `loginTitleHtml` | CSS `content`, or a template override | It is the message Keycloak already renders in the header, so it stays translatable and needs no template |
| Copy the admin UI's colours as plain values | Build the CSS from `apps/admin/src/index.css` | A handful of neutral colours that rarely change; a build step would be more to maintain than the copy |

## Interfaces and contracts

- **HTTP API**: None.
- **Configuration**: None. `realm.json` gains `"loginTheme": "rag-workspaces"`.
- **Data**: a new read-only bind mount, `./docker/keycloak/themes/rag-workspaces` →
  `/opt/keycloak/themes/rag-workspaces` in the `keycloak` service.
- **Langflow**: None.
- **Events and logs**: None. The element ids the admin UI's Playwright tests fill in (`#username`,
  `#password`, `#kc-login`) are Keycloak's and unchanged.

## Operations

A new install gets the theme on first start. An existing install imported the realm before, so Keycloak
doesn't read the new `loginTheme`: run `docker compose up -d` (to mount the theme), then pick
`rag-workspaces` under Realm settings > Themes > Login theme in the Keycloak admin console (README,
"Updating an existing install"). To go back, pick `keycloak.v2` there. If the theme folder is missing,
Keycloak logs a warning and falls back to its stock theme.

## Testing

- `scripts/smoke/check.ts`, step "Keycloak's sign-in page wears the admin UI's theme": starts a sign-in on the
  realm (as the account console would), checks the page links `login/rag-workspaces/css/rag-workspaces.css`
  and shows the brand panel, and that the stylesheet loads. Checked failing against the master realm (stock
  theme) and passing against `rag-workspaces`.
- The admin UI's Playwright sign-in tests (`apps/admin/e2e/sign-in.spec.ts`) sign in through the themed page.
- By hand: `docker compose up -d`, open the admin UI, press "Continue with Keycloak". Check light and dark
  mode, a narrow window, and a wrong password (Keycloak shows the error in red under the username field).

## Out of scope and follow-ups

- The Keycloak admin console, account console and emails keep the stock look.
- Other languages: only English messages are themed; the realm has internationalisation off.

## Docs updated

- `README.md`: "Updating an existing install" says how to switch an existing realm to the theme.
- `docs/architecture.md`: the `keycloak` row names the theme.
