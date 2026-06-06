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
#   3. Generate a SESSION_SECRET in .env if one isn't already present.
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

# 3. Generate SESSION_SECRET if not already set (forward-compatible; used by auth later).
if ! grep -q "^SESSION_SECRET=" .env; then
	echo "SESSION_SECRET=$(openssl rand -base64 48)" >> .env
	echo "Generated SESSION_SECRET in .env."
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
