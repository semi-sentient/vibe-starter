# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). From this release on, the changelog is maintained automatically by [release-please](https://github.com/googleapis/release-please) from conventional commits on `main`.

## [1.3.0](https://github.com/semi-sentient/vibe-starter/compare/vibe-starter-v1.2.0...vibe-starter-v1.3.0) (2026-06-07)


### Added

* **scripts:** rename README title on downstream reset; make reset tests portable ([2c99e3c](https://github.com/semi-sentient/vibe-starter/commit/2c99e3ceddafb341019ba8b57f261417d7455794)), closes [#6](https://github.com/semi-sentient/vibe-starter/issues/6)

## [1.2.0](https://github.com/semi-sentient/vibe-starter/compare/vibe-starter-v1.1.0...vibe-starter-v1.2.0) (2026-06-06)


### Added

* **bootstrap:** reset release state and rename via npm run setup ([826fb96](https://github.com/semi-sentient/vibe-starter/commit/826fb96c726ae3031c9db63c131ea847a6b6f45f)), closes [#6](https://github.com/semi-sentient/vibe-starter/issues/6)
* **scripts:** add downstream release-state reset module ([d06e9a6](https://github.com/semi-sentient/vibe-starter/commit/d06e9a62456639d39892a955cdede638579e791e)), closes [#6](https://github.com/semi-sentient/vibe-starter/issues/6)

## [1.1.0](https://github.com/semi-sentient/vibe-starter/compare/vibe-starter-v1.0.0...vibe-starter-v1.1.0) (2026-06-06)


### Added

* access control, orders resource, and the auth skill (P5) ([8f1c8da](https://github.com/semi-sentient/vibe-starter/commit/8f1c8da99b30b82093e102e0e54db7773fb421fd)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)
* add Drizzle ORM, users schema, and DB-aware health check ([35add46](https://github.com/semi-sentient/vibe-starter/commit/35add46cfa13ed26e481bb1c0dfcb4ed2b7f1a17)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)
* magic-link auth end-to-end (P4) ([9d7b3eb](https://github.com/semi-sentient/vibe-starter/commit/9d7b3ebbcc6cd05b8f45ee36eeec72d9b3a7ebf8)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)
* prefix PRD epic titles and auto-create their gh labels ([b2474ab](https://github.com/semi-sentient/vibe-starter/commit/b2474abc0c0b35214e0366a130ecd8ab0e08c4c6))
* scaffold full-stack app skeleton (Vite + React 19 + Hono) ([e4ede73](https://github.com/semi-sentient/vibe-starter/commit/e4ede73109f3188495f88c0deff20b4420db8f79)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)
* Stripe hosted Checkout vertical slice (P7) ([6686700](https://github.com/semi-sentient/vibe-starter/commit/66867009251f51eace970054c8f113ad1cfc5e25)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)
* structured logging, env hardening, and background workers (P8) ([708fff1](https://github.com/semi-sentient/vibe-starter/commit/708fff1ae92fff872f1eb5b6c890e0cec9d44455)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)
* Tailwind v4, shadcn/ui theme, Layout, and ErrorBoundary (P6) ([3097000](https://github.com/semi-sentient/vibe-starter/commit/309700044beb3c8495ae1f7d12193fa0fbf4123e)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)


### Fixed

* make user roles durable and upgrade-only ([0c9e26c](https://github.com/semi-sentient/vibe-starter/commit/0c9e26cbd2942594f9338b393fee472883dde88d)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)
* serve the web app from the repo root to avoid the /api proxy clash ([152da4f](https://github.com/semi-sentient/vibe-starter/commit/152da4fadb4a503b23ebc9a0a791d8846166a2cd)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)
* wire authed navigation so the checkout flow is reachable ([f76c475](https://github.com/semi-sentient/vibe-starter/commit/f76c475e794788258ddadaeaa912672a8df1ba08)), closes [#2](https://github.com/semi-sentient/vibe-starter/issues/2)

## [1.0.0] - 2026-06-05

Initial release of the `vibe-starter` template: an opinionated, MIT-licensed, full-stack TypeScript starter (Vite + React SPA, Hono + PostgreSQL API, end-to-end type safety) built to let a solo builder and their AI agent ship a real, maintainable app.

### Added

#### Authentication & access control

- Magic-link authentication (passwordless): a 6-digit code emailed via Resend, expiring after 10 minutes, exchanged for a Postgres-backed session and a signed `sid` cookie. Open self-signup — a `user` account is auto-created on first successful verify.
- Postgres-backed sessions with a 24-hour TTL and sliding refresh on each request (revocable, unlike JWTs; survive a reboot, unlike in-memory).
- Two-role RBAC (`admin` / `user`) as a Postgres enum, with `admin` granted via the `ADMIN_EMAILS` allowlist and re-asserted at every login, gated by a `requireRole('admin')` middleware.
- An IDOR-safe ownership rule: user-owned queries filter by the current user's id unless the caller is `admin`, mitigating the highest-severity bug a vibe coder ships (one customer reading or mutating another's data).
- Admin-managed invites (`/api/invites`) as an escape hatch for granting elevated roles out-of-band.
- CSRF protection: `SameSite=Lax`, `HttpOnly`, and `Secure` (in production) session cookies, plus an `Origin`-header check on non-GET requests.
- Fixed-window rate limiting backed by Postgres, keyed by `(ip, email)` (default 5 requests / 10 minutes), mounted on the open auth endpoints and reusable on any other route via `rateLimit({ key, limit, window })`.

#### Payments

- Stripe-hosted Checkout (redirect) wired end-to-end with a placeholder `Sample item` purchase, persisting a pending, user-owned `orders` row before redirecting.
- A `POST /api/stripe/webhook` route as the single source of truth for payment status — signature-verified against the raw request body, with idempotent handlers that survive Stripe redelivery; the client redirect is never trusted for payment state.

#### Data, observability & runtime

- Drizzle ORM over PostgreSQL with checked-in SQL migrations and a dual migration path: `drizzle-kit migrate` for dev (auto-run by the `predev` hook) and a programmatic `runMigrations()` for production (run by the Docker entrypoint before boot, with no `drizzle-kit` in the runtime image).
- Structured logging via pino.
- In-process periodic cleanup workers (`expireAuthCodes`, `expireSessions`, `cleanRateLimitCounters`) via a `runPeriodically` helper.
- Graceful shutdown: `SIGTERM`/`SIGINT` handlers stop the workers and drain in-flight work before exit.
- Boot-time environment validation with zod — the app fails loudly on startup if a required variable is missing or malformed.

#### Frontend

- A Vite + React 19 single-page app styled with Tailwind CSS v4 and shadcn/ui, with design tokens as CSS variables.
- TanStack Query for server state and React Router for routing.
- A typed Hono RPC client for end-to-end type safety between API and SPA.

#### Tooling, CI & deployment

- A Vitest test harness (component tests via React Testing Library; integration tests via in-process Hono against a real Postgres).
- ESLint flat config + Prettier + strict TypeScript (including `noUncheckedIndexedAccess`).
- Pre-commit quality gate: husky + lint-staged, plus a gitleaks secret scan.
- GitHub Actions CI (typecheck, lint, test against a Postgres service, build) with a gitleaks full-history backstop.
- Dockerized deployment: separate `api` and `web` images, the latter serving the static build via nginx with SPA fallback and an `/api` reverse proxy.
- release-please automation (this workflow) for conventional-commit-driven versioning and changelog maintenance.

#### Agent context

- First-class AI-agent context: a canonical `AGENTS.md`, topic docs under `docs/agents/`, the four `*_DESIGN.md` design documents, and a pre-installed bundled skills pipeline plus an `auth` skill shipped upfront.

[1.0.0]: https://github.com/semi-sentient/vibe-starter/releases/tag/v1.0.0
