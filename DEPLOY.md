# Deploying vibe-starter

This is the **go-live runbook** for getting the app onto [Railway](https://railway.com). The repo ships everything the build needs — two Dockerfiles, an nginx config, and per-service Railway config — so the steps below are mostly dashboard wiring a human does once.

> **Scope.** The build artifacts (`docker/Dockerfile.api`, `docker/Dockerfile.web`, `docker/nginx.conf.template`, `railway.*.json`) are verified to build and run locally. Standing up the live Railway project, entering secrets, enabling PR previews, and registering the live Stripe webhook are **manual, human-in-the-loop** actions — they need a Railway account and live keys and are intentionally not automated. The full pre-launch hardening pass — the [Ready for real users?](#ready-for-real-users) checklist at the end of this file — is the gate you run once the wiring below is done (see also [Going to production](#going-to-production)).

## Day one, in order

Everything below is reference material you can dip into. This is the order to actually do it in — each step links to its section.

1. **Get the app running on your own machine first** ([Quick Start](README.md#quick-start)). Nothing here is worth debugging remotely.
2. **Provision the Railway project** — Postgres, the api service, the web service, and a public domain for the web service ([Provision the Railway project](#provision-the-railway-project)).
3. **Set the environment variables** on both services ([Environment variables](#environment-variables)). The api refuses to boot if a required one is missing, on purpose.
4. **Run `npm run setup:github` once**, from your machine, so `main` only accepts merges when CI is green ([Branch protection](#branch-protection)).
5. **Turn on Wait for CI** in each Railway service, so a red build never becomes a deploy ([Continuous deploy from `main`](#continuous-deploy-from-main)).
6. **Publish for the first time** — merge a pull request into `main` and watch it go live. Before you invite anyone real, work through [Ready for real users?](#ready-for-real-users).

Steps 4 and 5 are the pair that makes "merged" mean "safe to deploy". Do them before the first publish, not after.

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
| `docker/Dockerfile.api`                 | Multi-stage build of the Hono server; runs migrations then serves on port 3000 |
| `docker/Dockerfile.web`                 | Multi-stage build of the SPA; nginx serves it and proxies `/api`               |
| `docker/nginx.conf.template`            | SPA fallback + `/api` reverse-proxy; `${API_UPSTREAM}` is substituted at start |
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
    - Set its **Config Path** to `railway.api.json` (Settings → Config-as-code). That pins the builder to `docker/Dockerfile.api` and the healthcheck to `/api/health`.
    - It needs **no public domain** — the web service reaches it privately. Note its **private address** (e.g. `<service>.railway.internal`); the web service points `API_UPSTREAM` at `<that-host>:3000`.
4. **Add the web service** from the same repo:
    - Set its **Config Path** to `railway.web.json` (builder → `docker/Dockerfile.web`).
    - **Generate a public domain** (Settings → Networking) — this is the app's public origin and the value of `APP_ORIGIN`.
    - Set `API_UPSTREAM` to the api service's private `host:3000` (see env table).

> Two services share this one repo. Railway builds each from its own **Config Path** (`railway.api.json` / `railway.web.json`), so the two Dockerfiles sit side by side in `docker/` without colliding. The deployment Docker build files — both Dockerfiles and `docker/nginx.conf.template` — live in `docker/`; `.dockerignore` and `docker-compose.yml` deliberately stay at the repo root, because Docker reads `.dockerignore` from the build-context root (always the repo root — see the smoke tests below) and `docker compose` only auto-discovers compose files in the CWD and its ancestors, not in subdirs.

## Environment variables

Set these per service in Railway (Variables tab). The api service is validated at boot by `src/env.ts` — a missing/malformed **required** var aborts startup with a one-line error. The web vars are **build-time** (`VITE_*` is baked into the bundle by `vite build`), so changing them requires a rebuild/redeploy, not just a restart.

### api service (runtime)

| Variable                 | Required | Notes                                                                                             |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | ✅       | Use Railway Postgres's **private** URL. Reference it as `${{Postgres.DATABASE_PRIVATE_URL}}`.     |
| `APP_ORIGIN`             | ✅       | The web service's **public** origin, no trailing slash (e.g. `https://app.example.com`).          |
| `SESSION_SECRET`         | ✅       | ≥32 chars. Generate with `openssl rand -base64 36`.                                               |
| `STRIPE_SECRET_KEY`      | ✅       | **Live** key (`sk_live_…`) in production.                                                         |
| `STRIPE_WEBHOOK_SECRET`  | ✅       | The `whsec_…` from the **live** webhook endpoint you create below.                                |
| `NODE_ENV`               | —        | Set to `production`. (`docker/Dockerfile.api` already defaults it; set it explicitly to be safe.) |
| `ADMIN_EMAILS`           | —        | Bootstrap/break-glass: comma-separated emails that resolve to ≥ `admin` at login (never demoted). |
|                          |          | Set once to mint the first admin, then invite the rest in-app (invites are durable). Blank is OK. |
| `RESEND_API_KEY`         | —        | Sends magic-link emails. **Unset = login codes are printed to the server log** (fine for a demo,  |
|                          |          | not for real users). Set a real key before launch.                                                |
| `ANTHROPIC_API_KEY`      | —        | Unused by shipped code; a validated slot for builders adding AI features.                         |
| `RAILWAY_GIT_COMMIT_SHA` | —        | Set automatically by Railway — nothing to configure. `/api/health` reports its first 7 characters |
|                          |          | as `sha`, so you can tell which commit is live. Absent locally, where `sha` is `null`.            |

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
- **Turn Wait for CI on.** Railway then holds the deploy until the commit's GitHub Actions checks pass, so a red build never reaches production. This is step 5 of [Day one](#day-one-in-order) and it is not optional in spirit — it is the other half of the required checks you set in [Branch protection](#branch-protection). The workflow (`.github/workflows/ci.yml`) runs four jobs: **Build & test** (typecheck, lint, the full Vitest suite against a real Postgres, then a production build), **Cross-platform build (…)** on Ubuntu, macOS and Windows, **Secret scan** (gitleaks over the full history), and **Docker smoke** (builds both Docker images, boots them against a real Postgres, and checks the app answers through nginx). The first, third and fourth are the ones `main` requires; the cross-platform legs are informational.
    > ⚠️ **Watch your first deploy to see what Wait for CI actually waits for.** Railway describes it as waiting for the commit's checks, and we have not confirmed whether that means _every_ check suite on the commit — including the informational cross-platform legs — or only the ones your ruleset requires. If a deploy sits waiting on a check you did not expect to gate it, that is why. Recorded here as an open question rather than guessed at.

## Rollback

Something went out that should not have. The fix is to put `main` back to a good commit: Railway deploys from `main`, so both services follow it together.

1. **Revert on a branch, then merge the PR.** `git revert <sha>` (or several), push the branch, let CI run, merge — the same route as any other change. A revert is a brand-new commit carrying no check runs, so once [`npm run setup:github`](#branch-protection) has been run, pushing it straight to `main` is refused by the required checks — the same mechanic as the ⚠️ release note in that section. Before the ruleset exists a direct push would still work, but the PR route works either way. Just tell your agent "go back to the version before X" — the contract it follows is the **Shipping** section of [`AGENTS.md`](AGENTS.md). Never force-push `main`: a revert is itself revertible, a rewritten history is not.
2. **Confirm what is actually live.** `curl https://<your-domain>/api/health` — the `sha` field is the first 7 characters of the commit currently serving, and `version` is its `package.json` version. Do not trust the dashboard's green tick over that.

**Manual fallback: redeploy an earlier build from the Railway dashboard.** Open the service → **Deployments**, find the last good one, and redeploy it. Two things to know before you rely on this:

- **It is per service, and it is not atomic.** The api and the web service have separate deployment histories. Rolling one back leaves the other on the new code until you roll that one back too, and in between the two halves of your app disagree — a rebuilt front end talking to an older API, or the reverse. Reverting on `main` avoids this entirely, because both services rebuild from the same commit. Use the dashboard when git is not an option (a bad build you cannot reproduce, a deploy that never finished), not as the routine path.
- **How far back the deployment history goes is a Railway retention/plan detail we have not verified.** Do not assume last week's build is still redeployable — check before you need it.

**Rolling back code does not roll back your database.** A revert undoes source changes; it does not undo a migration that already ran, and a column that was dropped is not coming back. So if the change you are undoing included a database migration, say so and think before reverting — the rationale, and the expand-then-contract discipline that keeps migrations revert-safe, is in [`docs/design/BACKEND_DESIGN.md`](docs/design/BACKEND_DESIGN.md).

## PR preview environments

**Opt-in, and off unless you turn them on.** Railway can give every open pull request its own throwaway copy of the app — both services, a fresh Postgres, its own URL — torn down when the PR closes or merges. That is genuinely useful for showing work-in-progress to someone who will never run it locally. It is also more moving parts and more money, and the publish loop this template ships does not depend on it: the local review your agent walks you through before every PR is the default review surface. Nothing in the repo enables previews; enable them when you want them and skip this section otherwise.

Enable at **project → Settings → Environments → Enable PR environments** (some plans call it _PR deploys_). Each open PR then gets its own copy of the services plus a fresh Postgres.

**Make a preview configure itself, using reference variables.** A preview that still points at production is worse than no preview: `APP_ORIGIN` drives magic-link redirect URLs and the CSRF Origin check, so a preview inheriting the production value bounces every sign-in back to prod. Railway's `${{service.VARIABLE}}` references resolve per environment, so setting these two once makes every future preview correct with no further editing:

- On the **api** service: `APP_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}`
- On the **web** service: `API_UPSTREAM=${{api.RAILWAY_PRIVATE_DOMAIN}}:3000`

Substitute your own service names if you did not call them `api` and `web`. In production these resolve to the production values, so the same two settings serve both environments — there is no separate production copy to keep in sync.

> ⚠️ **Never seal a variable the app needs in order to boot.** Railway lets you _seal_ a variable so its value can never be read back — not by you, not by the dashboard, not by the CLI. That is a one-way door: a sealed value cannot be copied into a new environment, so a preview can come up without it, and `src/env.ts` deliberately aborts the api's startup on any missing required var (`APP_ORIGIN`, `DATABASE_URL`, `SESSION_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). Leave those unsealed.

- **Leave Focused PR Environments off.** If Railway offers it, that setting deploys only the services a PR actually touched — which here means a front-end-only PR gets a preview with no api behind it, i.e. a blank page and failing `/api` calls. This app is two services behind one origin; a preview needs both.
- **Every preview starts with an empty database.** Migrations run on api boot so the schema is correct, but there are no users, no orders and no admin. Sign in fresh — the 6-digit code prints to the preview api's logs unless that preview has its own `RESEND_API_KEY` — and set `ADMIN_EMAILS` on the preview if you need an admin account.
- **Use test-mode Stripe keys and a separate webhook endpoint** (or skip Stripe in previews entirely). Never point a preview at the live webhook.

> ⚠️ **Check whether PR environments exist on your Railway plan before planning around them.** Whether the Hobby tier includes them is not something we have verified; if the toggle is missing from Settings → Environments, that is the likely reason rather than anything in this repo.

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

One command, run from your machine:

```sh
npm run setup:github
```

It applies a GitHub **repository ruleset** named `main-required-checks` to your default branch. `npm run setup` already tried to run it quietly during Quick Start, so if you had the [GitHub CLI](https://cli.github.com) installed, signed in, and admin access to the repo at that moment, it may already be done. Running it again is safe: it updates the existing ruleset in place rather than stacking duplicates.

**What it sets up:**

- **`main` will not accept a merge until CI is green** — specifically the `Build & test`, `Secret scan` and `Docker smoke` jobs. (Those three names are a contract shared with `.github/workflows/ci.yml`; the cross-platform legs stay informational and do not gate anything.)
- **Merged branches are deleted automatically** (`delete_branch_on_merge`), so your branch list stays short.
- **Auto-merge becomes available** in the GitHub UI. That is a **human** convenience only — your agent still watches the checks and merges the PR itself, per the Shipping section of [`AGENTS.md`](AGENTS.md). Don't write workflows that lean on it.

**What it deliberately does not set up: no required reviews, and no "require a pull request".** This is a solo-builder template. Requiring an approving review on a one-person repo just blocks you from merging your own work — self-approval is theatre. And the pull-request rule would add nothing the checks don't already give you: the required checks gate **any** update to `main`, merge or direct push alike, so a commit still cannot land until CI has gone green on it. Leaving the rule off keeps the ruleset to the one thing it is actually there for. Add both from GitHub's ruleset UI (Settings → Rules → Rulesets → `main-required-checks`) the day a second person joins — that is the moment they start earning their cost.

Do not read that as an escape hatch: **omitting the pull-request rule does not buy you an emergency push straight to `main`.** A brand-new commit pushed directly has no check runs on it, so the required checks reject it just as they would reject a red PR. The way to get something onto `main` in a hurry is still branch → push → let CI run → merge.

What this buys you is narrower than it sounds, and worth being honest about: CI proves the app **builds, boots, and passes its tests**. It cannot see that a page looks wrong. That is what the local review before every publish is for.

**It needs admin access to the repo.** Not `maintain` — admin. Rulesets and repository settings cannot be changed with anything less, so the script checks first and stops with a clear message rather than half-applying. A contributor working on a fork they administer will get the ruleset on their own fork, which is fine.

**If it says GitHub would not apply the ruleset, the usual cause is the plan.** Repository rulesets are a paid feature on **private** repos — on GitHub Free the write is refused. Inside `npm run setup` that is one calm line and an exit code of 0, and **the merge settings still get applied**, so a successful `npm run setup` does not by itself mean the ruleset is installed. Run `npm run setup:github` directly to see GitHub's own error. Your three options are: make the repo public, pay for a plan that includes rulesets, or carry on without it — everything else in this template works, you just don't get the required-checks guarantee.

**If you ever rename a CI job, re-run `npm run setup:github`.** A required check that names a job which no longer exists is accepted by GitHub and then waits forever, blocking every PR. The script refuses to install a ruleset naming a job it cannot find in `ci.yml`, which catches the mistake in the safe direction — but it cannot fix a rename that is already live on GitHub. Fix the workflow, then re-run.

**One honest caveat.** If you grant yourself a bypass on the ruleset in GitHub's UI, a later `npm run setup:github` may quietly drop it: the script does not send a bypass list, and GitHub does not document what omitting it means on an update. Check afterwards if you depend on one.

> ⚠️ **Open question: this ruleset may block `npm run release`, and nobody has run the two together yet.** `npm run release` builds a `chore(release): vX.Y.Z` commit on your machine and pushes it straight to `main` with `git push --follow-tags`. That commit has never been through CI, so it carries no check runs — and a required-checks ruleset gates **every** update to the branch, with no automatic exemption for admins (classic branch protection let repository admins through unless you ticked a box; a ruleset exempts nobody who is not listed as a bypass actor, and `npm run setup:github` lists no one). The expected outcome is a refused push and the release stopping at `Release failed while running: git push --follow-tags` — loudly, and before the GitHub release is created. **That is read off GitHub's documented behaviour, not observed here:** the ruleset has not been applied to any repo yet, so the first person to run both is the one who finds out.
>
> If it does happen, check the tag. `git push --follow-tags` is not atomic, and this ruleset targets branches, not tags — so the `vX.Y.Z` tag can reach GitHub even though the branch push was refused, leaving a published tag on a commit that is not on `main`. The next release then measures from that tag and finds nothing to release. Recover by deleting both copies before retrying: `git push --delete origin vX.Y.Z` and `git tag -d vX.Y.Z`.
>
> **How to resolve it is the repo owner's call, and this template deliberately does not make it.** The options, none of them endorsed here: list yourself as a bypass actor on the ruleset (simplest — and it means the checks no longer bind you either); cut releases on a branch and merge them through a PR like any other change (keeps the gate honest, costs a round trip); or turn the ruleset off for the minute a release takes (easy to forget to turn back on). Pick one deliberately and write down which — and re-read the bypass caveat above before picking the first.

## Going to production

The wiring above gets the app **deployed and reachable**. Two more one-time steps — one command, one set of dashboard toggles — finish the automation, and then the [Ready for real users?](#ready-for-real-users) checklist below is the gate that takes you from "it's live" to "it's safe for real customers."

One-time repo/dashboard settings to confirm:

- **Run `npm run setup:github` once.** It puts the required CI checks on `main` and turns on auto-delete of merged branches — see [Branch protection](#branch-protection). Nothing in CI does this for you: it runs from your machine, under your own GitHub login.
- **Auto-deploy and PR previews are dashboard toggles, not code.** Continuous deploy from `main` and per-PR preview environments are enabled in the Railway dashboard (see [Continuous deploy](#continuous-deploy-from-main) and [PR preview environments](#pr-preview-environments) above) — they're human-in-the-loop and aren't wired up by anything in the repo.

### Settings that don't travel via the template

GitHub's **"Use this template"** copies **files only** — repo-level settings don't come along, so they have to be applied to your new repo separately. `npm run setup:github` is what does that, and it covers both of the settings this template expects:

- **Required checks on `main`** — the `main-required-checks` ruleset (see [Branch protection](#branch-protection)). There is no manual equivalent worth typing out; run the command.
- **Auto-delete head branches** (`delete_branch_on_merge`) — applied by the same command, so there is normally nothing to do by hand. The manual path if you want it: GitHub → repo **Settings → General → Pull Requests → "Automatically delete head branches."** Keeps merged feature branches from piling up.

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
docker build -f docker/Dockerfile.api -t vibe-api .
docker run --rm -e DATABASE_URL=… -e APP_ORIGIN=http://localhost \
  -e SESSION_SECRET=$(openssl rand -base64 36) \
  -e STRIPE_SECRET_KEY=sk_test_x -e STRIPE_WEBHOOK_SECRET=whsec_x \
  -p 3000:3000 vibe-api
curl localhost:3000/api/health      # → {"db":"up","sha":null,"status":"ok","version":"<your package.json version>"}

# web: build, then run — nginx serves the SPA and proxies /api to $API_UPSTREAM
docker build -f docker/Dockerfile.web -t vibe-web .
docker run --rm -e API_UPSTREAM=host.docker.internal:3000 -p 8080:80 vibe-web
curl localhost:8080/                 # → index.html
curl localhost:8080/login            # → index.html (SPA fallback)
curl localhost:8080/api/health       # → proxied to the api → {"db":"up","sha":null,"status":"ok","version":"<your package.json version>"}
```

`version` is the api's `package.json` version, bundled into the image at build time. `sha` is `null` here because Railway is what injects `RAILWAY_GIT_COMMIT_SHA`; on a real deploy it is the first 7 characters of the deployed commit, so `/api/health` tells you exactly what is live.
