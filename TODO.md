# TODO — pre-launch checklist

Work remaining before tagging the template as ready for public use. Items are grouped by how they get verified. (The per-_project_ go-live gate for a builder shipping their own app lives in `DEPLOY.md` → "Ready for real users?"; this file is the template maintainer's release checklist.)

## Must do before release

- [ ] **Run the contact-form tutorial end-to-end with a real agent.** The first-feature walkthrough in `README.md` is prose + code the builder writes — it is never type-checked or linted in this repo, so it can rot. Before release, have an agent follow it from a clean checkout (add `CONTACT_EMAIL`, write the route + Resend wrapper, mount it, exercise valid/honeypot/`400`/`429`) and fix any drift from the real `rateLimit()` / Resend / zod APIs.
- [x] **Cross-platform smoke tests (P16).** The Tier-1 local-only runbook now lives in [`CONTRIBUTING.md`](CONTRIBUTING.md) → "Local verification" (clone → `bootstrap.sh` → `docker compose up -d` → `npm install` → `npm run dev` → sign up via the console code → `npm test` → `lint`/`typecheck`/`build` → a local commit). The CI OS matrix is the automated gate ([`.github/workflows/ci.yml`](.github/workflows/ci.yml) → the `cross-platform` job runs install/typecheck/lint/build on macOS, Linux, and Windows; the DB-backed `test` leg stays Linux-only). Verified on macOS this session; Linux/Windows are covered by the CI matrix (3-OS green is observable once the branch is pushed) plus a human run of the runbook. The five pre-listed risks are each fixed-or-documented in `CONTRIBUTING.md` → "Cross-platform risks": CRLF/line endings is fixed portably via [`.gitattributes`](.gitattributes); the Windows `CLAUDE.md` symlink, gitleaks presence, `bootstrap.sh` shell support, and the `:5432` port conflict are documented caveats.
- [ ] **Reconcile `skills-lock.json`.** Confirm the lock lists the 9 skills (the 7-skill PRD pipeline + `handoff` + `prototype`), that every entry has a real (non-placeholder) hash, and that `.agents/skills/` on disk matches the lock.
- [ ] **Enable "Allow GitHub Actions to create and approve pull requests."** Repo Settings → Actions → General → Workflow permissions. release-please can't open its release PR without it. (Also noted in `DEPLOY.md`.)

## Verify on real accounts (the builder's go-live journey; see `DEPLOY.md`)

These need external accounts, so they're maintainer dry-runs rather than CI gates.

- [ ] **Walk `DEPLOY.md` on fresh accounts.** Stand up a throwaway Railway project + Postgres, a fresh Resend account (incl. **verifying a sending domain** and confirming mail reaches a non-account address), and a Stripe account (test→live keys + the live webhook), following the runbook verbatim. Note any step that's stale or surprising.
- [ ] **Live-verify release-please.** Land a couple of conventional commits on `main` and confirm the release PR is opened and, on merge, the version + `CHANGELOG.md` are cut as expected.
- [ ] **(Optional) Railway live deploy dry-run (P16 Tier-2).** From a fresh clone: live Stripe-CLI webhook forwarding, push a PR to watch CI go green, and a real Railway deploy. **Never required to ship the template** — purely a confidence pass on the documented go-live path.

## Notes

- `CHANGELOG.md` is maintained by release-please from conventional commits — don't hand-edit it; just verify it cuts correctly (above).
