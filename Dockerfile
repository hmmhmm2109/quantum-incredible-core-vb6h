# Build stage
FROM node:20-alpine AS builder

# git for scripts/prebuild-git-agents.mjs — it clones each git-native agent's
# own repo at build time (agent dirs are not tracked in the app repo). The
# script falls back to the GitHub tarball API when git is missing, so images
# built from older app repos without this line still work.
RUN apk add --no-cache git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies. `npm install` (not `npm ci`) because a generated app repo
# may carry a lockfile that predates an edit to package.json; the version that
# matters — lyzr-architect-pg — is pinned EXACTLY, so it resolves identically here,
# in the sandbox, and on Netlify. (This comment used to claim the pin was "latest";
# it has been exact since 0.1.4, which is what stopped the sandbox and the deployed
# app running different package versions.)
RUN npm install --no-audit --no-fund

# Copy source files
COPY . .

# NOTE: migrations deliberately do NOT run here. They run at container start, via
# docker-entrypoint.sh — see the comment in that file. Building the schema into the
# image made rollbacks and missed migrations silent, and under Entra auth it would
# additionally require a database credential as a build arg, which persists in image
# layer history.

# Git-native agents: prebuild clones each agent's own repo (the app repo
# does not track agent dirs); Coolify supplies these only as build args.
ARG GIT_AGENT_REPOS
ARG GIT_AGENT_REPO_TOKEN
ENV GIT_AGENT_REPOS=${GIT_AGENT_REPOS} GIT_AGENT_REPO_TOKEN=${GIT_AGENT_REPO_TOKEN}

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application (standalone output)
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Start-time migrations need three things the standalone bundle does not trace,
# because nothing in the app's request path imports them:
#   * the generated SQL + journal (plain data files)
#   * the migration CLI (lyzr-architect-pg/bin + dist/migrate)
#   * drizzle's migrator module (the runtime only pulls in the query driver)
# Copied explicitly rather than via outputFileTracingIncludes so a missing piece
# fails THIS BUILD rather than the first container start of a deploy.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lyzr-architect-pg ./node_modules/lyzr-architect-pg
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
# postgres.js is only a TRANSITIVE dependency (via lyzr-architect-pg). Standalone
# does trace it — but only because the app's request path happens to import the DB
# layer. The migrator must not depend on that coincidence.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3333

ENV PORT=3333
ENV HOSTNAME="0.0.0.0"

# Migrate, then hand off to CMD. Overriding CMD keeps the server command visible
# and replaceable without losing the migration step.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
