# Sammelband

Self-hosted digital photo books. Folders hold albums; an album is a sequence of
blocks (headings, text, photo galleries and groups of those). Photos are
deduplicated on disk and resized on demand.

One installation hosts several independent **Sammelbände**, e.g. one per family
or group of friends. Each has its own users, folders, albums and photos, and
none can see another's.

- The **instance owner** sets the instance up and gets the first Sammelband.
  They create further Sammelbände (with an optional storage limit), send an
  invite link to each one's first admin, and can suspend or delete them. They
  see names and storage numbers of other Sammelbände, never their content.
- **Admins** manage the users of their Sammelband: create accounts or send
  invite links.
- Everyone in a Sammelband can see and edit all of its folders and albums.

Albums and folders can be shared with a public link (optionally with a
password and an expiry date). Visitors need no account and see photos in web
size, never the originals.

## Stack

- **Backend:** Bun, Hono, better-auth (email + password), Kysely on SQLite (`bun:sqlite`) or PostgreSQL
- **Frontend:** SvelteKit (Svelte 5) as a static SPA, shadcn-svelte, Tailwind v4, PhotoSwipe
- The backend serves the built SPA, so production is a single process and container.

## Development

```sh
bun install && bun install --cwd frontend
bun run dev            # backend on :3000 (restarts on change)
bun run dev:frontend   # Vite on :5173, proxies /api and /ws to :3000
```

Open http://localhost:5173. On the first start the backend prints a one-time
setup link with a code; use it to become the instance owner and name your
Sammelband. Afterwards admins create further accounts or invite links under
**Users**, and the owner manages Sammelbände under **Sammelbände**.

Checks:

```sh
bun run lint                   # Biome: format + lint, backend and frontend
bun run typecheck              # backend types
bun run --cwd frontend check   # svelte-check
bun test                       # service tests, SQLite in memory
```

To run the tests against Postgres, point `DATABASE_URL` at a throwaway database
(every table is emptied before each test):

```sh
docker run -d --rm --name sammelband-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=sammelband_test -p 55432:5432 postgres:17-alpine
bun run test:postgres          # uses TEST_DATABASE_URL or the container above
```

## Production

```sh
cp .env.example .env   # set SECRET_KEY (openssl rand -hex 32) and BASE_URL
docker compose up -d --build
docker compose logs app  # shows the setup link on first start
```

Data lives in two volumes: the SQLite database (`/data`, unused with Postgres) and the photos
(`/uploads`, originals plus a regenerable cache of resized versions).

## Configuration

| Variable | Default (dev) | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `BASE_URL` | `http://localhost:3000` | Public URL, used for the CSRF origin check |
| `SECRET_KEY` | dev placeholder | Signs sessions. Required in production |
| `DATABASE_URL` | unset | `postgres://user:pass@host:5432/db` to use PostgreSQL instead of SQLite |
| `DATABASE_PATH` | `./sammelband.db` | SQLite file (when `DATABASE_URL` is unset) |
| `UPLOADS_PATH` | `./uploads` | Photo storage |
| `FRONTEND_DIST` | `./dist/frontend` | Built SPA served by the backend |
| `TRUSTED_ORIGINS` | `http://localhost:5173` in dev | Extra origins allowed to make requests |

## Database

SQLite is the default; set `DATABASE_URL` to use PostgreSQL. Queries go through
[Kysely](https://kysely.dev), so the same code runs on both.

Migrations run automatically on every start:

1. better-auth's migrator creates or extends its own tables (`user`, `session`,
   `account`, `verification`, plus tables of enabled plugins) from the auth config.
2. Kysely's migrator applies the domain migrations in `src/db/migrations/`
   and records them in `kysely_migration`.

To change the schema, add a new file to `src/db/migrations/` and register it in
`src/db/migrations/index.ts`. Never edit a migration that has been released.
Use Kysely's schema builder and avoid dialect-specific SQL; if something can't
be expressed portably, branch on the adapter as `0001_initial.ts` does for
its trigger.
