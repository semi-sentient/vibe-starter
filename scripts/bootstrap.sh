#!/usr/bin/env bash
#
# One-time (idempotent) project setup. Safe to re-run.
#
#   bash scripts/bootstrap.sh [new-project-name]
#
# Steps:
#   1. Create .env from .env.example if it doesn't exist.
#   2. Rename the project in package.json — only when a name argument is given,
#      so re-running without an arg never double-renames.
#   3. Generate a SESSION_SECRET in .env if one isn't already present.
#   4. Print next steps.

set -euo pipefail

# Run from the repo root regardless of where the script is invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

NEW_NAME="${1:-}"

# 1. Create .env from the template if absent.
if [ ! -f .env ]; then
	cp .env.example .env
	echo "Created .env from .env.example."
else
	echo ".env already exists — leaving it untouched."
fi

# 2. Rename the project only if a name was supplied (keeps re-runs idempotent).
if [ -n "$NEW_NAME" ]; then
	if grep -q '"name": "vibe-starter"' package.json; then
		sed -i.bak "s/\"name\": \"vibe-starter\"/\"name\": \"$NEW_NAME\"/" package.json
		rm -f package.json.bak
		echo "Renamed project to \"$NEW_NAME\" in package.json."
	else
		echo "Project name is not the default \"vibe-starter\" — skipping rename."
	fi
fi

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
