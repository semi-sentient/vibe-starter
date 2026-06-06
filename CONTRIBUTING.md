# Contributing & maintainer verification

This file is for **template maintainers** — anyone validating `vibe-starter` itself before tagging a release. (If you cloned this template to build _your own_ app, you want [`README.md`](README.md) for setup and [`DEPLOY.md`](DEPLOY.md) for go-live.) The release gate lives in [`TODO.md`](TODO.md); this file is the step-by-step runbook behind its cross-platform item.

## Local verification (Tier 1)

The **Tier-1** journey proves the template works end-to-end on a fresh checkout with **zero external accounts** — no Resend, Stripe, Railway, or any signup. It runs on **macOS, Linux, and Windows (under WSL or Git-Bash)**. Everything below uses only local Postgres (via Docker) and the console-printed magic code.

Run it from a clean clone before cutting a release. CI runs the automatable parts on every push (see [Cross-platform CI](#cross-platform-ci-the-automated-gate)), so this manual pass is mainly about the human-in-the-loop steps: the console-magic-code login and the gitleaks pre-commit hook.

### The journey

```bash
# 1. Clone a fresh copy (don't reuse a dirty working tree).
git clone <repo-url> vibe-starter-verify && cd vibe-starter-verify

# 2. Create .env (copies .env.example + generates SESSION_SECRET).
bash scripts/bootstrap.sh
#    Equivalent without the script: cp .env.example .env  (then set SESSION_SECRET).

# 3. Start local Postgres.
docker compose up -d

# 4. Install dependencies.
npm install

# 5. Boot the app — `predev` runs db:migrate first, then web :5173 + api :3000.
npm run dev
```

Then exercise auth **without email**:

1. Open <http://localhost:5173> and confirm the Welcome page shows `API ✓ connected`.
2. Sign up / log in with any email address.
3. Because `RESEND_API_KEY` is unset, the 6-digit code is **printed to the api server console** instead of emailed. In the `npm run dev` output it appears in the green `api` pane as a pino `warn` line: `magic-link code (dev fallback — set RESEND_API_KEY to email it)` with the `code` field. Paste that code into the verify form to finish logging in.

Stop the dev server (`Ctrl-C`) before running the checks below.

Then run the full verification suite:

```bash
npm test          # Vitest, 115 tests. Includes the OFFLINE Stripe webhook
                  # anchor test (test #3): it signs a payload with
                  # stripe.webhooks.generateTestHeaderString and verifies it via
                  # constructEvent — pure HMAC, no network, no Stripe account.
npm run lint      # ESLint, zero warnings allowed.
npm run typecheck # tsc for the server and web tsconfigs.
npm run build     # Vite (web → dist/) + tsup (server → dist-server/).
```

Finally, exercise the **gitleaks pre-commit hook** with a throwaway commit:

```bash
git commit --allow-empty -m "chore: verify pre-commit hook"
```

The husky `pre-commit` hook runs lint-staged + the gitleaks secret scan. If gitleaks is installed it scans the staged diff; if not, it prints a warning and skips (see the [gitleaks](#2-gitleaks-binary-not-installed-locally) risk below). Either way the commit should succeed. Delete the verification clone when done.

> **`npm test` needs Postgres.** The Vitest harness connects to the local Postgres from step 3 to create and migrate `vibe_starter_test`. Run it while the `docker compose` container is up. (CI uses a Postgres _service_ container for the same reason — see below.)

### What's verified vs. documented per platform

- **macOS** — the automatable steps (`bootstrap.sh`, `npm install`, `typecheck`/`lint`/`build`, `npm test`) are verified to pass with zero manual fixes on the maintainer's machine, and CI re-runs install/typecheck/lint/build on `macos-latest`.
- **Linux** — CI runs the full suite (including the DB-backed `npm test`) on `ubuntu-latest`; the manual login/commit steps follow this runbook verbatim.
- **Windows (WSL / Git-Bash)** — CI runs install/typecheck/lint/build on `windows-latest`. The DB-backed `npm test`, `docker compose`, and the `bash scripts/*.sh` steps are run by a human under **WSL** (recommended) or **Git-Bash**, where a POSIX shell + Docker are available. Native PowerShell/cmd are **not** supported for the `bash` scripts (see the bootstrap risk below).

## Cross-platform risks

The starter has five known cross-platform sharp edges. Each is either fixed portably (in-repo) or documented as a caveat here.

### 1. `CLAUDE.md` is a git symlink → `AGENTS.md` (Windows)

`CLAUDE.md` is committed as a **symlink** to `AGENTS.md` (so the agent instructions have a single source). On macOS/Linux it resolves transparently. On **Windows**, if the clone happens without symlink support (the default unless `git config --global core.symlinks true` is set _and_ Developer Mode / admin rights allow it), git materializes `CLAUDE.md` as a **1-line text file containing the literal text `AGENTS.md`** rather than a working link.

- **Impact:** an agent told to read `CLAUDE.md` on such a checkout reads the string `AGENTS.md` instead of the instructions — it must follow that pointer to the real file. Humans are unaffected (the real content is in `AGENTS.md`).
- **Status — documented caveat.** We deliberately keep the symlink (one source of truth beats a maintained duplicate). Windows maintainers should clone with `core.symlinks=true`, or simply read `AGENTS.md` directly. There is no portable in-repo fix that preserves the single-source property.

### 2. gitleaks binary not installed locally

The pre-commit secret scan (`scripts/gitleaks-protect.sh`) shells out to `gitleaks`, a **Go binary**, not an npm dependency — so it may be absent.

- **Status — already mitigated (warns-and-skips).** When the binary is missing the hook prints a warning and exits 0, so commits aren't blocked; the `gitleaks-action` job in CI scans full history as the independent backstop, so a secret can never reach the remote unscanned. Install locally to scan before pushing: `brew install gitleaks` (macOS) or a release from <https://github.com/gitleaks/gitleaks/releases>.

### 3. `bootstrap.sh` shell support

`scripts/bootstrap.sh` is a **bash** script (it uses `openssl` and `sed`).

- **Status — documented caveat.** It runs under **WSL** and **Git-Bash** on Windows, and natively on macOS/Linux. It does **not** run in PowerShell or cmd. The portable manual fallback is `cp .env.example .env` followed by setting a `SESSION_SECRET` of ≥32 chars by hand. (Git for Windows bundles `openssl`, so Git-Bash has everything the script needs.)

### 4. CRLF / line endings

Without normalization, a Windows checkout would convert shell scripts and configs to **CRLF**, which breaks any file read by a POSIX shell (a CRLF shebang line fails to execute) or copied into a Linux container.

- **Status — fixed portably.** [`.gitattributes`](.gitattributes) pins `*.sh`, the husky hook, the Dockerfiles, the nginx `*.template`, and `*.yml`/`*.json`/`*.ts(x)` to `eol=lf` on every platform, and marks binary assets `-text`. This is the main portable fix landed for cross-platform support.

### 5. docker-compose host-port conflict (`:5432`)

`docker-compose.yml` publishes Postgres on host port **5432**. If something else already owns that port (a local Postgres install, another project's container), `docker compose up -d` fails to bind.

- **Status — documented caveat.** Map a different host port by editing the `ports` line in `docker-compose.yml` (e.g. `'5433:5432'`) and updating the port in `DATABASE_URL` in your `.env` to match (the container still listens on 5432 internally). Or stop the conflicting service. CI is unaffected — its Postgres service runs in an isolated runner.

## Cross-platform CI (the automated gate)

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) has two build jobs:

- **`build-and-test`** (ubuntu only) — attaches a Postgres **service container** and runs the full suite: install → typecheck → lint → `npm test` (DB-backed) → build. This is the single DB-backed leg.
- **`cross-platform`** — a `fail-fast: false` matrix over `[ubuntu-latest, macos-latest, windows-latest]` running install → typecheck → lint → build. It carries **no service container**, because GitHub Actions `services:` are declared at job level and are **Linux-only**; attaching one to the matrix would fail the macOS/Windows legs. The DB-backed test therefore stays in the ubuntu-only job, while this job proves the build itself runs everywhere.

A third job, `gitleaks`, scans full history. Cross-OS green is only observable once the branch is pushed and the workflow runs on GitHub's hosted runners.

## Tier 2 (optional go-live dry-run)

A **Tier-2** dry-run — live Stripe-CLI webhook forwarding, pushing a PR to watch CI go green, and a real Railway deploy from a fresh clone — exercises the builder's go-live path documented in [`DEPLOY.md`](DEPLOY.md). It requires external accounts (Stripe, GitHub, Railway) and is **optional**: it is tracked in [`TODO.md`](TODO.md) as a confidence pass and is **never required to ship the template**.
