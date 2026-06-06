# Deploying vibe-starter

This is the **go-live runbook** for getting the app onto [Railway](https://railway.com). The repo ships everything the build needs — two Dockerfiles, an nginx config, and per-service Railway config — so the steps below are mostly dashboard wiring a human does once.

> **Scope.** The build artifacts (`Dockerfile.api`, `Dockerfile.web`, `nginx.conf.template`, `railway.*.json`) are verified to build and run locally. Standing up the live Railway project, entering secrets, enabling PR previews, and registering the live Stripe webhook are **manual, human-in-the-loop** actions — they need a Railway account and live keys and are intentionally not automated. The full pre-launch hardening pass — the [Ready for real users?](#ready-for-real-users) checklist at the end of this file — is the gate you run once the wiring below is done (see also [Going to production](#going-to-production)).

## Architecture: one public origin

The deployed app is **single-origin**. nginx (the web service) does two jobs:

1. serves the built SPA (static files in `dist/`), and
2. reverse-proxies `/api/*` to the api service (the Hono server).

The browser only ever talks to the web origin, so:

- the session `sid` cookie stays **first-party** — no `SameSite=None`, no CORS credentials dance;
- `APP_ORIGIN` is that one public origin, and the server's CSRF Origin check and magic-link redirect URLs are all built from it;
- the api service does **not** need to be publicly exposed — only the web service needs a public domain. The web service reaches the api over Railway's private network.

```
            ┌─────────────────────────── web service (nginx) ───────────────────────────┐
browser ──► │  GET /            → static SPA (dist/)                                      │
  (one      │  GET /login       → SPA fallback (index.html)                               │
  origin)   │  /api/*           → proxy_pass → api service (Hono) on the private network  │
            └────────────────────────────────────────┬──────────────────────────────────┘
                                                       │  X-Forwarded-For: <client ip>
                                                       ▼
                                              api service (Hono :3000)
                                                       │
                                                       ▼
                                              Postgres (Railway add-on)
```

A two-origin topology (SPA and API on separate public domains, with CORS `allow-credentials` and a cross-site cookie) is possible but is an **escape hatch**, not the default — see [Two-origin escape hatch](#two-origin-escape-hatch).

## What ships in the repo

| File                                    | Purpose                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `Dockerfile.api`                        | Multi-stage build of the Hono server; runs migrations then serves on port 3000 |
| `Dockerfile.web`                        | Multi-stage build of the SPA; nginx serves it and proxies `/api`               |
| `nginx.conf.template`                   | SPA fallback + `/api` reverse-proxy; `${API_UPSTREAM}` is substituted at start |
| `scripts/docker-entrypoint.sh`          | api entrypoint: migrate, then `exec` the server (PID 1, graceful SIGTERM)      |
| `railway.api.json` / `railway.web.json` | Per-service Railway build/deploy config (point each service at its Dockerfile) |
| `.dockerignore`                         | Keeps the build context lean                                                   |

### How the api container starts

`docker-entrypoint.sh` runs `node dist-server/migrate.js` (the programmatic migrator — it replays the committed `src/db/migrations/*.sql` against `DATABASE_URL`) and **only if that succeeds** `exec`s `node dist-server/index.js`. A failed migration exits non-zero and aborts the deploy, so you never serve against a half-migrated schema. `drizzle-kit` is **not** in the runtime image — migrations run from the checked-in SQL, not the CLI.

## Provision the Railway project

Do this once in the [Railway dashboard](https://railway.com/dashboard).

1. **Create a project** from this GitHub repo.
2. **Add Postgres**: _New → Database → Add PostgreSQL_. Railway provisions it and exposes `DATABASE_URL` (and `DATABASE_PRIVATE_URL`) as service variables. Prefer the **private** URL for the api service to keep DB traffic off the public network.
3. **Add the api service** from the repo:
    - Set its **Config Path** to `railway.api.json` (Settings → Config-as-code). That pins the builder to `Dockerfile.api` and the healthcheck to `/api/health`.
    - It needs **no public domain** — the web service reaches it privately. Note its **private address** (e.g. `<service>.railway.internal`); the web service points `API_UPSTREAM` at `<that-host>:3000`.
4. **Add the web service** from the same repo:
    - Set its **Config Path** to `railway.web.json` (builder → `Dockerfile.web`).
    - **Generate a public domain** (Settings → Networking) — this is the app's public origin and the value of `APP_ORIGIN`.
    - Set `API_UPSTREAM` to the api service's private `host:3000` (see env table).

> Two services share this one repo. Railway builds each from its own **Config Path**, so both Dockerfiles live at the repo root without colliding.

## Environment variables

Set these per service in Railway (Variables tab). The api service is validated at boot by `src/env.ts` — a missing/malformed **required** var aborts startup with a one-line error. The web vars are **build-time** (`VITE_*` is baked into the bundle by `vite build`), so changing them requires a rebuild/redeploy, not just a restart.

### api service (runtime)

| Variable                | Required | Notes                                                                                             |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | ✅       | Use Railway Postgres's **private** URL. Reference it as `${{Postgres.DATABASE_PRIVATE_URL}}`.     |
| `APP_ORIGIN`            | ✅       | The web service's **public** origin, no trailing slash (e.g. `https://app.example.com`).          |
| `SESSION_SECRET`        | ✅       | ≥32 chars. Generate with `openssl rand -base64 36`.                                               |
| `STRIPE_SECRET_KEY`     | ✅       | **Live** key (`sk_live_…`) in production.                                                         |
| `STRIPE_WEBHOOK_SECRET` | ✅       | The `whsec_…` from the **live** webhook endpoint you create below.                                |
| `NODE_ENV`              | —        | Set to `production`. (`Dockerfile.api` already defaults it; set it explicitly to be safe.)        |
| `ADMIN_EMAILS`          | —        | Bootstrap/break-glass: comma-separated emails that resolve to ≥ `admin` at login (never demoted). |
|                         |          | Set once to mint the first admin, then invite the rest in-app (invites are durable). Blank is OK. |
| `RESEND_API_KEY`        | —        | Sends magic-link emails. **Unset = login codes are printed to the server log** (fine for a demo,  |
|                         |          | not for real users). Set a real key before launch.                                                |
| `ANTHROPIC_API_KEY`     | —        | Unused by shipped code; a validated slot for builders adding AI features.                         |

> `PORT`: not needed. The server listens on a fixed `3000` and the web service proxies to `${API_UPSTREAM}` (default `…:3000`). If you expose the api publicly on Railway anyway, Railway's edge maps the public port to the container's 3000.

### web service

| Variable                      | Required | Notes                                                                                             |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `API_UPSTREAM`                | ✅       | api service `host:port`, e.g. `api.railway.internal:3000`. nginx proxies `/api/*` here.           |
| `VITE_API_URL`                | —        | **Leave unset** for single-origin (defaults to `/` = same origin). Only set for the escape hatch. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | —        | Build-time. Only needed if you add Stripe.js/Elements; the shipped hosted-Checkout flow doesn't.  |

## Continuous deploy from `main`

Railway's GitHub integration auto-deploys on push by default. Confirm in each service's **Settings → Deploy / Source**:

- **Production branch = `main`.** Every merge to `main` triggers a build + deploy of that service (Railway only rebuilds a service when files in its build context change).
- Keep **Wait for CI** on if you want Railway to hold the deploy until the GitHub Actions checks (lint, typecheck, tests, build — see `.github/workflows/ci.yml`) pass. Recommended, so a red build never reaches production.

## PR preview environments

Railway can spin up an ephemeral environment per pull request.

- Enable **Settings → Environments → Enable PR environments** (or _PR deploys_) on the project. Each open PR gets its own copy of the services + a fresh Postgres, torn down when the PR closes/merges.
- **Set the preview's `APP_ORIGIN` to the preview web URL.** Magic-link redirects and the CSRF Origin check are built from `APP_ORIGIN`; if it still points at production, login links in a preview will bounce to prod. Railway exposes the generated domain as a variable (e.g. `RAILWAY_PUBLIC_DOMAIN`) you can reference.
- Previews should use **test-mode** Stripe keys and their **own** webhook endpoint (or skip Stripe). Don't point a preview at the live webhook.

## Resend: real sign-in (and contact) email

With `RESEND_API_KEY` unset the magic-link code is printed to the api **server log** — fine for a demo, useless for real users (they never see your logs). Wire up [Resend](https://resend.com) before launch.

1. **Create a Resend account** and an API key: Dashboard → API Keys → **Create API Key**. Copy the `re_…` value into the api service's `RESEND_API_KEY` (see the env table above).
2. **Verify a sending domain** (the important step): Dashboard → Domains → **Add Domain**, then add the **DNS records Resend shows** (SPF/DKIM, and a return-path/MX record) at your DNS provider. Verification can take a few minutes to propagate.
    > **Until a domain is verified, Resend only delivers to your _own_ account email.** Sign-in codes (and contact-form mail) to anyone else will silently not arrive. Verify the domain _before_ inviting real users.
3. **Set the `from` address to your verified domain.** The shipped wrapper (`src/server/email/resend.ts`) sends from Resend's shared `onboarding@resend.dev` sender; once your domain is verified, change `FROM` there (and in any wrapper you added, e.g. the contact-form tutorial) to `you@your-verified-domain`.

## Stripe live webhook

Payments are confirmed server-side by the webhook (`POST /api/stripe/webhook`, raw-body signature verified, CSRF-exempt), so it must reach the deployed api.

1. In the [Stripe dashboard](https://dashboard.stripe.com) (live mode) → Developers → Webhooks → **Add endpoint**.
2. **Endpoint URL** = your public origin + `/api/stripe/webhook`, e.g. `https://app.example.com/api/stripe/webhook`. (It goes through the web origin; nginx proxies `/api/*` to the api service.)
3. Subscribe to the Checkout events the server handles (at minimum `checkout.session.completed`).
4. Copy the endpoint's **Signing secret** (`whsec_…`) into the api service's `STRIPE_WEBHOOK_SECRET`, and swap `STRIPE_SECRET_KEY` from your dev `sk_test_…` to the matching **live** `sk_live_…` key (Developers → API keys, live mode). The signing secret and the secret key must both be from the **same mode** — a test secret against a live webhook (or vice-versa) fails signature verification and the payment never confirms.

## Optional: a custom domain

Railway gives each web service a `*.up.railway.app` domain that works out of the box. To serve the app on your own domain instead:

1. **Add the domain in Railway** (web service → Settings → Networking → **Custom Domain**). Railway shows the DNS record(s) to create.
2. **Point your registrar's DNS** at Railway: add the **CNAME** (or the records Railway specifies) at your DNS provider for the host you're using (e.g. `app.example.com`). Wait for it to verify.
3. **Update `APP_ORIGIN`** on the api service to the custom origin (`https://app.example.com`, no trailing slash) and redeploy. `APP_ORIGIN` drives magic-link redirect URLs and the CSRF Origin check, so a stale value bounces logins to the old domain.
4. **Update the Stripe webhook endpoint URL** (and any OAuth/redirect URLs) to the new origin + `/api/stripe/webhook`.

## Branch protection

Configure on GitHub (Settings → Branches → add a rule for `main`).

- **Multi-contributor repos:** require a PR, require the CI status checks to pass, and require **≥1 approving review** before merge. Optionally require branches be up to date and require linear history. This pairs with "Wait for CI" above so only green, reviewed code deploys.
- **Solo / template use:** branch protection is optional — leave it off (or require just the status checks) so you're not blocked reviewing your own PRs. The repo is a starter; tighten this once a team forms.

## Going to production

The wiring above gets the app **deployed and reachable**. Two more one-time **dashboard/GitHub actions** finish the automation, and then the [Ready for real users?](#ready-for-real-users) checklist below is the gate that takes you from "it's live" to "it's safe for real customers."

One-time repo/dashboard settings to confirm:

- **Enable "Allow GitHub Actions to create and approve pull requests."** GitHub → repo **Settings → Actions → General → Workflow permissions**. Without it, [release-please](https://github.com/googleapis/release-please) cannot open its release PR, so versioning + the changelog never get cut.
- **Auto-deploy and PR previews are dashboard toggles, not code.** Continuous deploy from `main` and per-PR preview environments are enabled in the Railway dashboard (see [Continuous deploy](#continuous-deploy-from-main) and [PR preview environments](#pr-preview-environments) above) — they're human-in-the-loop and aren't wired up by anything in the repo.

### Settings that don't travel via the template

GitHub's **"Use this template"** copies **files only** — repo-level settings don't come along, so set these by hand on your new repo (one time each):

- **Allow GitHub Actions to create and approve pull requests** — required so release-please can open its PR. This is the first bullet above; see it for the exact location.
- **Branch protection** — not copied either. Decide per the [Branch protection](#branch-protection) section above (optional for solo/template use, recommended once a team forms).
- **Auto-delete head branches** (`delete_branch_on_merge`) — GitHub → repo **Settings → General → Pull Requests → "Automatically delete head branches."** Keeps merged release-please and feature branches from piling up.

## Ready for real users?

This is the canonical pre-launch checklist (there is intentionally **no separate `LAUNCH_CHECKLIST.md`** — this section is it). The setup above gets you a live deployment; this is the **gate** you run before pointing real customers at it, especially before taking real payments. If anything below is unchecked, you're not ready yet. It's your own self-review, not an external audit.

**Access control is intact.**

- [ ] Admin-only routes are gated with `requireRole('admin')`.
- [ ] User-owned queries filter by the current user — a customer can never reach another customer's row (no IDOR).
- [ ] The access-control anchor test passes (see `docs/design/BACKEND_DESIGN.md`).

**Secrets are safe.**

- [ ] Every secret lives in an env var, never in code — `gitleaks` reports clean (the pre-commit hook + CI full-history scan).
- [ ] `.env` is gitignored and was never committed.

**Stripe is production-ready.**

- [ ] Swapped from test-mode to **live-mode** keys (`sk_live_…` + the live webhook's `whsec_…`).
- [ ] The webhook signature is verified against the **raw request body**, and you've run the full flow end-to-end with a real card.
- [ ] Payment status comes from the **webhook**, never from the client redirect.

**The database is protected.**

- [ ] Backups are enabled (Railway Postgres backup add-on) and you've confirmed you know how to restore one.

**Production config is correct.**

- [ ] All required env vars are set in the Railway **production** environment.
- [ ] The app fails loudly at startup on a missing/malformed var (the zod env validation in `src/env.ts`).

**You can see what's happening.**

- [ ] The root error boundary works (a friendly error, not a white screen).
- [ ] Structured logging is on and you know how to find errors in the Railway logs.

**It works on a phone.**

- [ ] A quick pass on a real phone or device emulator — most customers are mobile.

**Legal & safety basics.**

- [ ] A privacy policy and terms of service are published.
- [ ] **If your app handles children's or other sensitive personal data:** get the appropriate consent (e.g. **parental consent** before collecting anything about a child) and collect the **minimum** data you need, deleting what you don't.

> The children's-data note is a COPPA-style "minimize and get parental consent" guideline — **not legal advice.** Handling children's or other sensitive personal data carries real legal obligations that vary by jurisdiction; if you're unsure, consult a professional before launch.

## Two-origin escape hatch

Single-origin (above) is the default and the easy path. If you must serve the SPA and API on **separate public domains** (e.g. `app.example.com` + `api.example.com`):

- Build the web image with `VITE_API_URL=https://api.example.com` so the RPC client calls the API's absolute origin instead of same-origin `/api`. You can drop the nginx `/api` proxy in that case.
- The api must send **CORS** headers that allow the SPA origin **with credentials** (`Access-Control-Allow-Origin: https://app.example.com` + `Access-Control-Allow-Credentials: true` — a wildcard origin is invalid with credentials), and the `sid` cookie must become cross-site (`SameSite=None; Secure`), which weakens the first-party-cookie posture.
- `APP_ORIGIN` stays the **SPA** origin (it drives redirects + the CSRF Origin check).

This adds moving parts and a weaker cookie posture for no benefit in the common case — prefer single-origin unless a hard constraint forces the split.

## Local container smoke test

You don't need Railway to sanity-check the images. Against a local Postgres:

```sh
# api: build, then run it pointed at a database, migrate-on-boot + health
docker build -f Dockerfile.api -t vibe-api .
docker run --rm -e DATABASE_URL=… -e APP_ORIGIN=http://localhost \
  -e SESSION_SECRET=$(openssl rand -base64 36) \
  -e STRIPE_SECRET_KEY=sk_test_x -e STRIPE_WEBHOOK_SECRET=whsec_x \
  -p 3000:3000 vibe-api
curl localhost:3000/api/health      # → {"db":"up","status":"ok"}

# web: build, then run — nginx serves the SPA and proxies /api to $API_UPSTREAM
docker build -f Dockerfile.web -t vibe-web .
docker run --rm -e API_UPSTREAM=host.docker.internal:3000 -p 8080:80 vibe-web
curl localhost:8080/                 # → index.html
curl localhost:8080/login            # → index.html (SPA fallback)
curl localhost:8080/api/health       # → proxied to the api → {"db":"up","status":"ok"}
```
