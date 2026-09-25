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
COPY db/schema.sql ./db/schema.sql
COPY package.json tsconfig.json bunfig.toml ./

RUN mkdir -p /data /uploads/originals /uploads/variants

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
