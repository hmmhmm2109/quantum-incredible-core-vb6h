#!/bin/sh
# Migrate, then serve.
#
# Migrations used to run at IMAGE BUILD (`RUN npm run db:migrate`) while the image's
# CMD started the server directly, bypassing the `prestart` hook. Two consequences,
# both silent: rolling back to an older image did not roll back the schema, and a
# missed migration produced a container that started and passed health checks while
# every write failed on a missing column.
#
# Running here instead means the schema is reconciled against the database this
# container is actually pointed at, at the moment it starts.
#
# `set -e` is the "fails loudly" half: a failed migration aborts before the server
# starts, so the deploy fails visibly instead of serving a half-migrated schema.
set -e

if [ -n "$DATABASE_URL" ]; then
  echo "entrypoint: applying database migrations"
  # Invoked by path rather than via `npm run`: the production image is a Next.js
  # standalone bundle with no npm scripts and a pruned node_modules.
  node ./node_modules/lyzr-architect-pg/bin/lyzr-pg-migrate.mjs
  echo "entrypoint: migrations complete"
else
  echo "entrypoint: DATABASE_URL not set — skipping migrations (app has no database)"
fi

exec "$@"
