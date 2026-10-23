# Secure IT Support Portal — production image
#
# Multi-stage build producing a minimal runtime image via Next.js
# `output: 'standalone'` (see next.config.js). No secrets are baked into
# this image: .env, data/, and runtime database/backup files are excluded
# by .dockerignore and supplied at container start via docker-compose
# (env_file + volume mounts), not at build time.
#
# tidecloak.json IS copied into the build context and compiled into the
# JS bundle at build time — several files (app/layout.tsx, middleware.ts,
# API routes) statically import it. It is not a login credential (it's the
# already-provisioned realm's public adapter config: embedded JWKS public
# key, vendor ID, signed origin material), but it is realm-specific and
# gitignored, so it must exist locally before building and is never
# committed. See README.md for details.

# ---- deps: install dependencies only ----------------------------------
FROM node:20-alpine AS deps
# Next.js on Alpine needs libc6-compat for some native deps (e.g. sharp).
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the production build -----------------------------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# tidecloak.json must exist in the build context (see header comment).
RUN test -f tidecloak.json || \
    (echo "ERROR: tidecloak.json is missing. Export it from the already-provisioned" \
          "support-spike realm before building — see README.md." && exit 1)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner: minimal production image -----------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user, matching the official Next.js Docker example.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# /app/data is where the app's own API routes (case content, signed policy
# bytes) read and write — bind-mounted by docker-compose, not baked in.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
