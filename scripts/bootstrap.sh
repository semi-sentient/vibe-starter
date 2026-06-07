#!/usr/bin/env bash
#
# One-time (idempotent) project setup. Safe to re-run.
#
#   bash scripts/bootstrap.sh [project-name]
#
# Steps:
#   1. Create .env from .env.example if it doesn't exist.
#   2. Reset downstream release state and rename the project: pick a project name
#      (arg > interactive prompt > the repo directory name) and hand it, with the
#      git origin, to scripts/reset-release-state.mjs. That module owns the guards
#      and idempotency — it no-ops on the upstream template, on the default name,
#      and on an already-renamed package — so this step always calls it.
#   3. Generate a strong SESSION_SECRET in .env when the value is empty or still
#      the template placeholder (a real, user-set secret is left untouched).
#   4. Print next steps.

set -euo pipefail

# Run from the repo root regardless of where the script is invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# 1. Create .env from the template if absent.
if [ ! -f .env ]; then
	cp .env.example .env
	echo "Created .env from .env.example."
else
	echo ".env already exists — leaving it untouched."
fi

# 2. Reset release state and rename the project. Pick the name from (in order):
#    an explicit argument, an interactive prompt, or the repo directory name. The
#    module decides whether anything actually changes (see its guards).
DEFAULT_NAME="$(basename "$REPO_ROOT")"
if [ -n "${1:-}" ]; then
	NAME="$1"
elif [ -t 0 ]; then
	read -r -p "Project name [$DEFAULT_NAME]: " NAME
	NAME="${NAME:-$DEFAULT_NAME}"
else
	NAME="$DEFAULT_NAME"
fi

ORIGIN="$(git remote get-url origin 2>/dev/null || true)"
node "$REPO_ROOT/scripts/reset-release-state.mjs" "$NAME" "$ORIGIN"

# 3. Ensure a strong SESSION_SECRET. The `sid` cookie signature depends on it, so a
#    shared default is a real auth weakness — `.env.example` ships it EMPTY and we
#    fill it here. Regenerate only when the value is empty or still the legacy
#    template placeholder; a real, user-set secret is left untouched, so re-running
#    setup never rotates it (which would invalidate every live session).
LEGACY_PLACEHOLDER="change-me-to-a-random-string-at-least-32-chars"
CURRENT_SECRET="$(grep -m1 "^SESSION_SECRET=" .env | cut -d= -f2- || true)"
if [ -z "$CURRENT_SECRET" ] || [ "$CURRENT_SECRET" = "$LEGACY_PLACEHOLDER" ]; then
	SECRET="$(openssl rand -base64 48)"
	if grep -q "^SESSION_SECRET=" .env; then
		# Rewrite the line in place. `awk -v` keeps base64's `/ + =` literal (sed
		# would treat them as delimiters/backrefs); capture-then-write so a failed
		# awk can't truncate .env.
		UPDATED="$(awk -v secret="$SECRET" \
			'/^SESSION_SECRET=/ { print "SESSION_SECRET=" secret; next } { print }' .env)"
		printf '%s\n' "$UPDATED" >.env
	else
		# No line at all (e.g. someone deleted it) — append a fresh one.
		printf 'SESSION_SECRET=%s\n' "$SECRET" >>.env
	fi
	echo "Generated a strong SESSION_SECRET in .env."
else
	echo "SESSION_SECRET already set in .env — leaving it untouched."
fi

# 4. Next steps.
cat <<'EOF'

Bootstrap complete. Next:
  1. Edit .env with your real values (DATABASE_URL is pre-filled for docker compose).
  2. docker compose up -d
  3. npm install
  4. npm run dev
EOF
