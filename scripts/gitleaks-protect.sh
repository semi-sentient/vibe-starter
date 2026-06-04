#!/usr/bin/env sh
#
# Pre-commit secret scan, run from lint-staged's global entry.
#
# gitleaks is a Go binary (not an npm package), so it may not be installed on
# every contributor's machine. We treat its absence as a soft skip — printing a
# visible warning and exiting 0 — rather than blocking the commit. CI runs
# `gitleaks/gitleaks-action` against full history as the independent backstop, so
# a missing local binary never lets a secret reach the remote unscanned.
#
# When the binary IS present we run `gitleaks protect --staged` and propagate its
# exit code, so a detected secret rejects the commit.
#
# Install gitleaks locally to scan before pushing:
#   brew install gitleaks
#   # or download a release: https://github.com/gitleaks/gitleaks/releases

set -eu

if command -v gitleaks >/dev/null 2>&1; then
	exec gitleaks protect --staged --no-banner
fi

echo "⚠ gitleaks not installed — skipping local secret scan (CI is the backstop). Install: brew install gitleaks" >&2
exit 0
