# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
From this release on, the changelog is maintained automatically by
[release-please](https://github.com/googleapis/release-please) from conventional
commits on `main`.

## [1.0.0] - 2026-06-05

Initial release of the `vibe-starter` template: an opinionated, MIT-licensed,
full-stack TypeScript starter (Vite + React SPA, Hono + PostgreSQL API,
end-to-end type safety) built to let a solo builder and their AI agent ship a
real, maintainable app.

### Added

#### Authentication & access control

- Magic-link authentication (passwordless): a 6-digit code emailed via Resend,
  expiring after 10 minutes, exchanged for a Postgres-backed session and a
  signed `sid` cookie. Open self-signup — a `user` account is auto-created on
  first successful verify.
- Postgres-backed sessions with a 24-hour TTL and sliding refresh on each
  request (revocable, unlike JWTs; survive a reboot, unlike in-memory).
- Two-role RBAC (`admin` / `user`) as a Postgres enum, with `admin` granted via
  the `ADMIN_EMAILS` allowlist and re-asserted at every login, gated by a
  `requireRole('admin')` middleware.
- An IDOR-safe ownership rule: user-owned queries filter by the current user's
  id unless the caller is `admin`, mitigating the highest-severity bug a vibe
  coder ships (one customer reading or mutating another's data).
- Admin-managed invites (`/api/invites`) as an escape hatch for granting
  elevated roles out-of-band.
- CSRF protection: `SameSite=Lax`, `HttpOnly`, and `Secure` (in production)
  session cookies, plus an `Origin`-header check on non-GET requests.
- Fixed-window rate limiting backed by Postgres, keyed by `(ip, email)`
  (default 5 requests / 10 minutes), mounted on the open auth endpoints and
  reusable on any other route via `rateLimit({ key, limit, window })`.

#### Payments

- Stripe-hosted Checkout (redirect) wired end-to-end with a placeholder
  `Sample item` purchase, persisting a pending, user-owned `orders` row before
  redirecting.
- A `POST /api/stripe/webhook` route as the single source of truth for payment
  status — signature-verified against the raw request body, with idempotent
  handlers that survive Stripe redelivery; the client redirect is never trusted
  for payment state.

#### Data, observability & runtime

- Drizzle ORM over PostgreSQL with checked-in SQL migrations and a dual
  migration path: `drizzle-kit migrate` for dev (auto-run by the `predev` hook)
  and a programmatic `runMigrations()` for production (run by the Docker
  entrypoint before boot, with no `drizzle-kit` in the runtime image).
- Structured logging via pino.
- In-process periodic cleanup workers (`expireAuthCodes`, `expireSessions`,
  `cleanRateLimitCounters`) via a `runPeriodically` helper.
- Graceful shutdown: `SIGTERM`/`SIGINT` handlers stop the workers and drain
  in-flight work before exit.
- Boot-time environment validation with zod — the app fails loudly on startup
  if a required variable is missing or malformed.

#### Frontend

- A Vite + React 19 single-page app styled with Tailwind CSS v4 and shadcn/ui,
  with design tokens as CSS variables.
- TanStack Query for server state and React Router for routing.
- A typed Hono RPC client for end-to-end type safety between API and SPA.

#### Tooling, CI & deployment

- A Vitest test harness (component tests via React Testing Library;
  integration tests via in-process Hono against a real Postgres).
- ESLint flat config + Prettier + strict TypeScript (including
  `noUncheckedIndexedAccess`).
- Pre-commit quality gate: husky + lint-staged, plus a gitleaks secret scan.
- GitHub Actions CI (typecheck, lint, test against a Postgres service, build)
  with a gitleaks full-history backstop.
- Dockerized deployment: separate `api` and `web` images, the latter serving
  the static build via nginx with SPA fallback and an `/api` reverse proxy.
- release-please automation (this workflow) for conventional-commit-driven
  versioning and changelog maintenance.

#### Agent context

- First-class AI-agent context: a canonical `AGENTS.md`, topic docs under
  `docs/agents/`, the four `*_DESIGN.md` design documents, and a pre-installed
  bundled skills pipeline plus an `auth` skill shipped upfront.

[1.0.0]: https://github.com/semi-sentient/vibe-starter/releases/tag/v1.0.0
