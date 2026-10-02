# Sammelband

Self-hosted digital photo books. Folders hold albums; an album is a sequence of
sections, each with a title, text and photos (shown in justified rows), and
optionally highlighted. Photos are deduplicated on disk and resized on demand.

One installation can host several independent **Sammelbände**, e.g. one per
family or group of friends (off by default, enable with `MULTI_TENANT=true`).
Each has its own users, folders, albums and photos, and none can see another's.

- The **instance owner** sets the instance up and gets the first Sammelband.
  They create further Sammelbände (with an optional storage limit), send an
  invite link to each one's first admin, and can suspend or delete them. The
  app shows them names and storage numbers of other Sammelbände, not their
  content. (Whoever runs the server can of course read its database and files;
  host Sammelbände only for people who trust you with their photos.)
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

A Bun workspace: `apps/server` (backend), `apps/web` (SPA) and `packages/shared`
(the API types both use). Run the scripts from the repo root; `.env`, the SQLite
file, `uploads/` and `dist/` live there too.

## Development

```sh
bun install
bun run dev            # backend on :3000 (restarts on change)
bun run dev:web        # Vite on :5173, proxies /api and /ws to :3000
```

Open http://localhost:5173. On the first start the backend prints a one-time
setup link with a code; use it to become the instance owner and name your
Sammelband. Afterwards admins create further accounts or invite links under
**Users**, and the owner manages Sammelbände under **Sammelbände**.

Checks:

```sh
bun run lint                   # Biome: format + lint, all packages
bun run typecheck              # server and shared types
bun run check:web              # svelte-check
bun run test                   # service tests, SQLite in memory
```

To run the tests against Postgres, point `DATABASE_URL` at a throwaway database
(every table is emptied before each test):

```sh
docker run -d --rm --name sammelband-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=sammelband_test -p 55432:5432 postgres:17-alpine
bun run test:postgres          # uses TEST_DATABASE_URL or the container above
```

## Translations

The UI is available in English and German ([Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs)).
Messages live in `apps/web/messages/<locale>.json`; the locale list is in
`apps/web/project.inlang/settings.json`. Users pick their language on the sign-in page
or in their profile; otherwise the browser language is used.

## Production

```sh
cp .env.example .env   # set SECRET_KEY (openssl rand -hex 32) and BASE_URL
docker compose up -d
docker compose logs app  # shows the setup link on first start
```

The image is `ghcr.io/wendevlin/sammelband` for amd64 and arm64:

| Tag | What |
|---|---|
| `latest` | The newest stable release |
| `beta` | The newest pre-release (until 1.0 the only releases there are) |
| `nightly`, `nightly-YYYYMMDD` | Built from `main` every night with new commits |
| `0.1.0`, `0.1.0-beta.1`, … | One release |

Pick one with `SAMMELBAND_TAG` in `.env` (default `latest`). To update, `docker
compose pull && docker compose up -d`; migrations run on start. To build the
image from source instead: `docker build -t ghcr.io/wendevlin/sammelband:latest .`

Data lives in two volumes: the SQLite database (`/data`, unused with Postgres) and the photos
(`/uploads`, originals plus a regenerable cache of resized versions). Named
volumes and bind mounts (`./db_data:/data`) both work: the container starts as
root only to hand these two directories to the app user, then runs the app as
that user (uid/gid 1000 by default; set `PUID`/`PGID` to use another, e.g. your
NAS user). Don't set `user:` in compose; the entrypoint can't fix the owner then.

Put a reverse proxy with TLS in front (Caddy, Traefik, nginx). Set
`TRUST_PROXY=true` so rate limits see the real client IP, and configure HSTS
there; the app doesn't send it.


## Configuration

| Variable | Default (dev) | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port of the server (the dev proxy follows it). Fixed to 3000 in the Docker image |
| `HOST_PORT` | `3000` | `docker compose` only: the host port mapped to the container's 3000 |
| `BASE_URL` | `http://localhost:3000` | Public URL, used for the CSRF origin check |
| `SECRET_KEY` | dev placeholder | Signs sessions and share-link cookies. Required in production, at least 32 characters |
| `DATABASE_URL` | unset | `postgres://user:pass@host:5432/db` to use PostgreSQL instead of SQLite |
| `DATABASE_PATH` | `./sammelband.db` | SQLite file (when `DATABASE_URL` is unset) |
| `UPLOADS_PATH` | `./uploads` | Photo storage |
| `FRONTEND_DIST` | `./dist/frontend` | Built SPA served by the backend |
| `TRUSTED_ORIGINS` | `http://localhost:5173` in dev | Extra origins allowed to make requests |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limiting. Only behind a proxy that sets it |
| `MAX_UPLOAD_MB` | `50` | Largest accepted photo |
| `MULTI_TENANT` | `false` | Host several Sammelbände; the owner manages them under Admin settings |
| `SOURCES_ALLOW_PRIVATE_HOSTS` | `true` (`false` with `MULTI_TENANT`) | Let photo sources (Nextcloud) live on private addresses: home network, Tailscale, the same host |
| `SMTP_HOST` | unset | SMTP server for email. Without it no mail is sent and "Forgot password?" is hidden |
| `SMTP_PORT` | `587` (`465` with `SMTP_SECURE`) | SMTP port |
| `SMTP_SECURE` | `true` on port 465 | TLS from the start (465); otherwise STARTTLS is used when offered |
| `SMTP_USER`, `SMTP_PASSWORD` | unset | SMTP login |
| `SMTP_FROM` | required with `SMTP_HOST` | Sender, e.g. `Sammelband <sammelband@example.com>` |

With SMTP set up, users reset a forgotten password with a link by mail. It works
once within an hour and signs them out everywhere. `BASE_URL` has to be the
address people open, since the link points there. The server checks the SMTP
connection at startup and logs the result.

## Photo sources (Nextcloud)

Besides uploads, photos can come from a Nextcloud. An admin switches it on under
Admin settings → Photo sources with the Nextcloud address; then everyone connects
their own account in their profile (they sign in to Nextcloud and allow access, or
enter an app password). In the album editor, "Add photos" then offers "From Nextcloud":
browse the folders, pick photos, and they are copied into the album like uploads.
Sammelband never serves anything from Nextcloud itself, so public links keep working
when files move there. The picker opens in the folder you used last.

Login data is stored encrypted with `SECRET_KEY`; changing it means connecting the
accounts again. Photo formats Sammelband can't read (HEIC, RAW) are imported as
Nextcloud's large JPEG preview.

## Database

SQLite is the default; set `DATABASE_URL` to use PostgreSQL. Queries go through
[Kysely](https://kysely.dev), so the same code runs on both.

Migrations run automatically on every start:

1. better-auth's migrator creates or extends its own tables (`user`, `session`,
   `account`, `verification`, plus tables of enabled plugins) from the auth config.
2. Kysely's migrator applies the domain migrations in `apps/server/src/db/migrations/`
   and records them in `kysely_migration`.

To change the schema, add a new file to `apps/server/src/db/migrations/` and register it in
`apps/server/src/db/migrations/index.ts`. Never edit a migration that has been released.
Use Kysely's schema builder and avoid dialect-specific SQL; if something can't
be expressed portably, branch on the adapter as `0001_initial.ts` does for
its trigger.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## License

The code is licensed under the [Apache License 2.0](LICENSE). The name
"Sammelband" and the Sammelband logo are not covered by that license.
