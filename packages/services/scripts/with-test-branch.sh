#!/usr/bin/env bash
# Runs a command against a fresh, migrated, seeded Neon branch, then deletes the
# branch whatever happens. The same approach as packages/db's script of the
# same name; this one also seeds the catalog, because the templates the
# services materialize reference catalog rows. No fallback to an existing
# database (root CLAUDE.md: integration tests on a real branch, not mocks).
#
# Auth: an interactive `neon auth` locally; NEON_API_KEY in CI.
set -euo pipefail

PROJECT_ID=super-bar-40420599
BRANCH="test/services-${GITHUB_RUN_ID:-local-$(id -un)}-$(date +%s)"
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

# Migrations and the seed belong to packages/db; run them from there.
npm run --silent migrate -w @workout-tracker/db
npm run --silent seed -w @workout-tracker/db
"$@"
