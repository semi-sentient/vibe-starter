#!/bin/sh
# Container entrypoint for the api image (Dockerfile.api).
#
# Runs the programmatic migrator (the P2 `runMigrations()`, bundled to
# dist-server/migrate.js) and ONLY if it succeeds boots the server. `set -e`
# makes a failed migration abort startup with a non-zero exit, so a bad migration
# fails the deploy instead of serving against a half-migrated schema.
#
# The server is started with `exec` so it replaces this shell as PID 1 and
# receives SIGTERM directly — that drives the graceful shutdown in
# src/server/index.ts (drain in-flight requests, close the pool) on redeploy/stop.
set -e

echo "[entrypoint] applying database migrations"
node dist-server/migrate.js

echo "[entrypoint] starting server"
exec node dist-server/index.js
