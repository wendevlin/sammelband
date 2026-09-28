FROM oven/bun:1.4.2 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM base AS frontend
WORKDIR /app/frontend
COPY bunfig.toml frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
RUN bun run build

FROM base AS production
ENV NODE_ENV=production
ENV FRONTEND_DIST=/app/dist/frontend
COPY --from=deps /app/node_modules ./node_modules
COPY --from=frontend /app/dist/frontend ./dist/frontend
COPY src/ ./src/
COPY package.json tsconfig.json bunfig.toml ./

# Run as the image's unprivileged "bun" user (uid 1000). Named volumes take
# over this ownership; bind mounts must be writable by uid 1000.
RUN mkdir -p /data /uploads/tenants && chown -R bun:bun /data /uploads
USER bun

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
