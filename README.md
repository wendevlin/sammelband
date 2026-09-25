# Sammelband

Self-hosted digital photo books. Folders hold albums; an album is a sequence of
blocks (headings, text, photo galleries and groups of those). Photos are
deduplicated on disk and resized on demand.

Everyone with an account can see and edit every folder and album. Admins can
additionally manage users. There are no public share links (yet).

## Stack

- **Backend:** Bun, Hono, better-auth (email + password), SQLite via `bun:sqlite`
- **Frontend:** SvelteKit (Svelte 5) as a static SPA, shadcn-svelte, Tailwind v4, PhotoSwipe
- The backend serves the built SPA, so production is a single process and container.

## Development

```sh
bun install && bun install --cwd frontend
bun run dev            # backend on :3000 (restarts on change)
bun run dev:frontend   # Vite on :5173, proxies /api and /ws to :3000
```

Open http://localhost:5173. On the first start the backend prints a one-time
setup link with a code; use it to create the first admin. Afterwards admins
create further accounts under **Users**.

Checks:

```sh
bun run typecheck && bun run lint                # backend
bun run --cwd frontend check && bun run --cwd frontend lint
```

## Production

```sh
cp .env.example .env   # set SECRET_KEY (openssl rand -hex 32) and BASE_URL
docker compose up -d --build
docker compose logs app  # shows the setup link on first start
```

Data lives in two volumes: the SQLite database (`/data`) and the photos
(`/uploads`, originals plus a regenerable cache of resized versions).

## Configuration

| Variable | Default (dev) | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `BASE_URL` | `http://localhost:3000` | Public URL, used for the CSRF origin check |
| `SECRET_KEY` | dev placeholder | Signs sessions. Required in production |
| `DATABASE_PATH` | `./sammelband.db` | SQLite file |
| `UPLOADS_PATH` | `./uploads` | Photo storage |
| `FRONTEND_DIST` | `./dist/frontend` | Built SPA served by the backend |
| `TRUSTED_ORIGINS` | `http://localhost:5173` in dev | Extra origins allowed to make requests |

## Database

The schema lives in `db/schema.sql` and is applied on every start (all
statements are `IF NOT EXISTS`). There are no migrations while the app is not in
production use: change the schema file and delete the dev database. Once real
data exists, migrations have to come back.
