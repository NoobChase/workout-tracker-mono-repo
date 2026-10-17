#!/usr/bin/env bash
# Runs a command against a fresh, migrated Neon branch, then deletes the branch
# whatever happens. The integration tests are not optional (root CLAUDE.md), so
# there is deliberately no fallback to an existing database.
#
#   scripts/with-test-branch.sh node --import tsx --test 'test/**/*.test.ts'
#
# Auth: an interactive `neon auth` locally; NEON_API_KEY in CI. The branch is a
# copy-on-write child of `dev`, so new migrations are tested against the state
# they will actually meet. Its connection string lives only in this process's
# environment.
set -euo pipefail

PROJECT_ID=super-bar-40420599
BRANCH="test/${GITHUB_RUN_ID:-local-$(id -un)}-$(date +%s)"
neon="npx --no-install neon"

$neon branches create --project-id "$PROJECT_ID" --name "$BRANCH" --parent dev --output json >/dev/null
trap '$neon branches delete "$BRANCH" --project-id "$PROJECT_ID" >/dev/null' EXIT

DATABASE_URL="$($neon connection-string "$BRANCH" --project-id "$PROJECT_ID")"
case "$DATABASE_URL" in
  *-pooler.*) echo "expected a direct connection string, got a pooled one" >&2; exit 1 ;;
  postgres*) ;;
  *) echo "could not get a connection string for $BRANCH" >&2; exit 1 ;;
esac
export DATABASE_URL

npx --no-install drizzle-kit migrate
"$@"
