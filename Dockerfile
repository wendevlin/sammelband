FROM oven/bun:1.4.2 AS base
WORKDIR /app

# Only the workspace manifests, so the install layers stay cached until they change.
FROM base AS manifests
COPY package.json bun.lock bunfig.toml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

# Runtime dependencies. The web app has none (its build tools are devDependencies).
FROM manifests AS deps
RUN bun install --frozen-lockfile --production

# The SPA is the same on every platform: build it natively on the build machine
# instead of under emulation for multi-arch images.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.2 AS web
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN bun run build

FROM base AS production
# Set by the release workflow: "0.1.0-beta.1", "nightly-20260930", …
ARG VERSION=dev
ENV SAMMELBAND_VERSION=$VERSION
ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/dist/frontend
# Defaults so the bare image runs; docker-compose.yml mounts volumes at these paths.
ENV DATABASE_PATH=/data/sammelband.db
ENV UPLOADS_PATH=/uploads
# The container always listens on 3000 (EXPOSE and HEALTHCHECK match it); pick
# the host port with the port mapping, e.g. -p 8080:3000.
ENV PORT=3000
# Isolated installs: a package store at the root, links in each workspace.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=web /app/dist/frontend ./dist/frontend
COPY package.json bunfig.toml ./
COPY packages/shared/ ./packages/shared/
COPY apps/server/package.json apps/server/tsconfig.json ./apps/server/
COPY apps/server/src/ ./apps/server/src/

# The app runs as the unprivileged "bun" user (uid 1000, or PUID/PGID). The
# entrypoint starts as root only to hand /data and /uploads to that user (bind
# mounts are often root-owned), then drops privileges for good.
RUN mkdir -p /data /uploads/tenants && chown -R bun:bun /data /uploads
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "apps/server/src/index.ts"]
