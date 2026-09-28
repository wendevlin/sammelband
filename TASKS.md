# Sammelband: slim-down and move to a SvelteKit SPA

## Context

Sammelband is a self-hosted, block-based photo book (folders → albums → blocks → photos). The previous MVP scope (granular grants, password-protected share links, magic links, SQL migrations) was too big for the current state: nobody uses it yet. The goal is a lightweight core that actually gets finished, plus a frontend rebuild on SvelteKit + shadcn-svelte as a pure SPA served by the Bun backend.

Decisions made (agreed with the user):
- **Roles:** only `admin` and `user`. Every logged-in user sees and edits all folders and albums. Admins additionally manage users. No grants, no share links, no public view. *(Superseded by the roadmap, see below.)*
- **Login:** email + password only. Magic link, password reset by mail, SMTP/nodemailer are removed. Admins set passwords.
- **HTTP framework:** switch from Elysia (1.4.28 installed, 2.0 announced with breaking changes) to **Hono**. Reasons: stable API since v4, Bun-native (`hono/bun` for WebSocket upgrade and static files), validation via `@hono/zod-validator` + `zod`, official better-auth integration. NestJS rejected: Node/Express-centric, DI/modules/gateways are too much ceremony for ~35 routes. Services are framework-free and stay unchanged; only routes, middleware and `index.ts` are rewritten.
- **WebSocket live updates:** stay, but for all logged-in users instead of admins only.
- **DB:** no more migrations. One `db/schema.sql`, applied idempotently on startup. The existing dev DB is discarded. *(Superseded by the roadmap, see below.)*
- **Frontend:** SvelteKit (Svelte 5, runes) + shadcn-svelte + Tailwind v4, `adapter-static` with SPA fallback, `ssr = false`. Separate package in `frontend/`. Backend serves `dist/frontend`.

## Initial state (analysis)

**Stack:** Bun 1.4 + Elysia 1.2 + better-auth 1.2 + `bun:sqlite` directly (no ORM; `kysely` is in `package.json` but never imported). Frontend: Lit 3 + Web Awesome + PhotoSwipe, Vite 6, custom mini router. No git repo, no tests, no CLAUDE.md.

**Backend (`src/`, ~2,900 lines):**
- `index.ts`: Elysia app, all HTTP routes under `/api`, `/ws`, `/health`. **Does not serve the frontend** (no static handler); the `Dockerfile` doesn't build the frontend either. → SPA serving has to be built from scratch.
- `auth.ts`: better-auth with `emailAndPassword` + `magicLink` plugin + `sendResetPassword`, `mailer.ts` (nodemailer, dev fallback to console). `user.role` as additionalField (`input: false`).
- `middleware/auth.middleware.ts`: `adminRouter()` (session + role admin + origin/CSRF check) and `userRouter()` (session only, no CSRF check). All write routes are admin-only.
- `db/client.ts`: SQLite with WAL/FK, migration runner over `db/migrations/*.sql` and a `_migrations` table. Three migrations (initial, block groups, gallery-owned photos). `db/schema.ts` only has TS types.
- Domain services (good, worth keeping): `folder.service` (tree, cycle check, delete only when empty), `album.service` (slug per folder, cover explicit or first image, `attachCovers`), `block.service` (heading/text/gallery/group, one level of nesting, fractional `sort_order` per parent), `image.service` (SHA-256 dedup in `image_files`, Bun.Image variants 400/800/1200/1920 webp/jpeg with cache, placeholder, dedup-aware disk cleanup), `storage.service` (stats, orphan count, clear cache), `onboarding.service` (bootstrap code on first start → first admin).
- To remove: `access.service` (recursive CTEs for grant inheritance), `grant.service`, `share.service` (token, argon2 password, expiry, revoke), `lib/signed-cookie.ts` (sb_share cookie), `routes/share.ts`, `routes/admin/shares.ts`, `routes/admin/grants.ts`, share-cookie path in `routes/images.ts`, `albums.shareable`.
- `lib/events.ts` + `routes/ws.ts`: in-process pub/sub, topics `folder-tree`, `album-list`, `folder:<id>`, `album:<id>`, `photo-pool:<id>`, `storage-stats` (+ share/access topics, which go away). WS upgrade currently checks role admin.
- `rate-limit.middleware.ts`: simple IP buckets for auth and upload. Keep.

**Frontend (`frontend/src`, ~4,000 lines of Lit):** pages login, onboarding, home (folder tree + albums), folder-view, album-view (PhotoSwipe across all galleries of the album, groups with auto background from photo colors), share-view, admin-home (folder/album CRUD), admin-users, album-edit (meta, cover, tabs: block editor with HTML5 DnD, gallery photos upload/reorder/caption, access, shares), storage. `store/ws.ts` (reconnect with backoff, subscription replay) and `api.ts` are framework-independent and can be carried over almost 1:1. Web Awesome and Lit go away entirely.

**DB schema (target after slim-down):** `user`, `session`, `account`, `verification` (better-auth), `folders`, `albums` (without `shareable`), `album_blocks` (with `parent_id`, type CHECK incl. `group`), `image_files`, `photos` (`block_id NOT NULL`), trigger `trg_photos_clear_cover`. Removed: `share_links`, `album_access`, `folder_access`, `_migrations`. `created_by`/`uploaded_by` become nullable with `ON DELETE SET NULL` so admins can delete users.

## Target API

All content routes require a session (any user), writes additionally the origin check. `admin` routes require role admin.

| Area | Routes |
|---|---|
| Auth | `/api/auth/sign-in/email`, `/api/auth/sign-out`, `/api/auth/get-session` (better-auth; `sign-up` stays blocked) |
| Onboarding | `GET /api/onboarding/status`, `POST /api/onboarding/claim` |
| Folders | `GET /api/folders`, `POST /api/folders`, `GET /api/folders/:id` (folder + subfolders + albums with cover), `PATCH /api/folders/:id`, `DELETE /api/folders/:id` |
| Albums | `GET /api/albums`, `POST /api/albums`, `GET /api/albums/:id` (album + blocks + photos), `PATCH /api/albums/:id`, `DELETE /api/albums/:id`, `POST /api/albums/:id/cover` |
| Blocks | `GET/POST /api/albums/:id/blocks`, `PATCH/DELETE /api/albums/:id/blocks/:blockId`, `POST /api/albums/:id/blocks/reorder` |
| Photos | `POST /api/blocks/:blockId/photos` (upload, rate-limited), `POST /api/blocks/:blockId/photos/reorder`, `PATCH /api/photos/:id`, `DELETE /api/photos/:id` |
| Images | `GET /api/images/:filename?w=400\|800\|1200\|1920&format=webp\|jpeg`; without `w` → original |
| Admin | `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id` (name, role), `POST /api/admin/users/:id/password`, `DELETE /api/admin/users/:id`, `GET /api/admin/storage`, `POST /api/admin/storage/clear-cache` |
| WS | `/ws` for all logged-in users |
| SPA | everything else → `dist/frontend` (assets) or `index.html` (fallback) |

## Tasks

### Phase 0: Housekeeping
- [x] `git init`, check `.gitignore` (already fine: db, uploads, dist, .env), save the initial state as the first commit. This keeps the old Lit frontend in history as a reference.
- [x] Add `TASKS.md` (this plan) to the repo.
- [x] Clear local `sammelband.db*` and `uploads/` (dev data, schema changes).
- [x] Remove deps from root `package.json`: `kysely` (unused), `nodemailer`, `@types/nodemailer`, `elysia`; add `hono`, `@hono/zod-validator`, `zod`. Frontend deps (`lit`, `@awesome.me/webawesome`, `photoswipe`, `vite`) move into the frontend package in phase 3.

### Phase 1: Slim down the backend
- [x] **Schema instead of migrations.** Delete `db/migrations/`, create `db/schema.sql` (target schema above, all `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `CREATE TRIGGER IF NOT EXISTS`). In `src/db/client.ts` replace `runMigrations()` with `initSchema()`, which runs the file once via `db.exec`. Drop the `_migrations` table. `src/db/schema.ts`: remove `ShareLink` and `shareable`, `block_id: string`, `created_by: string | null`.
- [x] **Simplify auth.** `src/auth.ts`: remove the `magicLink` plugin and `sendResetPassword`. Delete `src/mailer.ts`. `src/config.ts`: remove the `SMTP` block, trim `.env.example` and `docker-compose*.yml` accordingly.
- [x] **Elysia → Hono.** `src/index.ts`: `new Hono<{ Variables: { user: AuthUser } }>()`, started via `Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch, websocket })`. `app.onError` maps `AppError` → `{ error }` with status, everything else → 500 (replaces the existing `onError` in `index.ts`). better-auth per the official Hono guide: `app.on(["GET","POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))`, preceded by a middleware that blocks `POST /api/auth/sign-up/email` with 403, and the auth rate limiter. Validation: `zValidator("json" | "param" | "query" | "form", schema)` instead of `t.*`; translate the schemas 1:1 from the existing `t.Object` definitions. Upload: `c.req.parseBody({ all: true })`, `files` can be `File | File[]`. Port the rate-limit middleware (`rate-limit.middleware.ts`) as Hono middleware (logic stays). Handlers that already return a `Response` (`serveVariant`, `serveOriginal`) work unchanged in Hono.
- [x] **Middleware.** `src/middleware/auth.middleware.ts` as Hono middlewares: `requireAuth` (session via `auth.api.getSession({ headers: c.req.raw.headers })`, sets `c.set("user", ...)`, else 401) and `requireAdmin` (401/403). CSRF: `hono/csrf` with `origin: [BASE_URL, dev: localhost:5173]` globally in front of all `/api` write routes, so user writes are protected too (previously only `adminRouter`). Per router: `router.use("*", requireAuth)` or `requireAdmin`.
- [x] **Remove shares/grants/access.** Delete: `src/services/share.service.ts`, `grant.service.ts`, `access.service.ts`, `src/lib/signed-cookie.ts`, `src/routes/share.ts`, `src/routes/admin/shares.ts`, `src/routes/admin/grants.ts`. Remove the share-cookie path and `isAuthorized` from `routes/images.ts` (only check: session present?). `folder.service.deleteFolder`: drop `DELETE FROM share_links/folder_access`. `album.service`: remove `shareable` everywhere.
- [x] **Move routes.** `src/routes/admin/{folders,albums,blocks,photos}.ts` → `src/routes/{folders,albums,blocks,photos}.ts`, each a `new Hono()` with `requireAuth`, mounted via `app.route("/api/folders", folders)` etc., `/admin` prefix gone. Dissolve `src/routes/user.ts`: read routes into their respective files, `getAlbumDetail` into `album.service`. Move the helpers `listFolderContents`/`folderExists` from `access.service` into `folder.service`. Drop `adminImageRoutes` (`/admin/images/:filename`), make `w` optional in `/api/images/:filename` instead. Rewire `src/index.ts` accordingly; `/api/admin/users/by-email` goes away.
- [x] **Extend user management.** `src/routes/admin/users.ts`: `PATCH` allows `name` + `role`; new `POST /:id/password` (hash via `auth.$context` → `password.hash` + `internalAdapter.updatePassword`), `DELETE /:id`. Guards: can't delete yourself, can't delete or demote the last admin. Password change invalidates the user's sessions (`DELETE FROM session WHERE userId`).
- [x] **WebSocket.** `src/routes/ws.ts` on `createBunWebSocket()` from `hono/bun`: `app.get("/ws", requireAuth, upgradeWebSocket((c) => ({ onOpen, onMessage, onClose })))`, the `websocket` object goes to `Bun.serve`. Subscription map per connection in the closure instead of `ws.data.store`. Admin check removed (session is enough), topic patterns `share-links:*` and `access:*` removed, wire protocol unchanged (frontend `ws.ts` needs no changes).
- [x] `bun run typecheck` + `bun run lint` green; smoke test via curl (onboarding → login → folder/album/block/upload/image).

### Phase 2: Backend serves the SPA + Docker
- [x] `src/config.ts`: `FRONTEND_DIST` (default `./dist/frontend`).
- [x] `src/routes/spa.ts`: mounted last in `index.ts`. Unmatched `/api/*` and `/ws` → 404 JSON. Then `serveStatic({ root: FRONTEND_DIST })` from `hono/bun` with `onFound` setting `Cache-Control: public, max-age=31536000, immutable` for `/_app/immutable/*`. Fallback `app.get("*")` returns `index.html` with `Cache-Control: no-cache` (`serveStatic` handles path traversal). If no dist exists (dev without build): 404 with a hint.
- [x] `Dockerfile`: stage `frontend-build` (bun install in `frontend/`, `bun run build`), copy the result to `/app/dist/frontend` in the production stage. `db/` → `db/schema.sql`. Delete root `vite.config.ts`.
- [x] Root `package.json` scripts: `dev` (backend), `dev:frontend` → `bun run --cwd frontend dev`, `build:frontend` → `bun run --cwd frontend build`, `build` = both. `biome.json`: exclude `frontend/**` (Prettier formats Svelte, see phase 3). `tsconfig.json`: remove `db/**/*.ts` from `include`.

### Phase 3: SvelteKit scaffold
- [x] Delete old `frontend/` (it's in git), scaffold fresh: `bunx sv create frontend` (Svelte 5, TypeScript, minimal, add-ons prettier + eslint + tailwindcss), `bunx sv add` equivalents as needed. `@sveltejs/adapter-static` with `pages`/`assets` → `../dist/frontend`, `fallback: 'index.html'`. `src/routes/+layout.ts`: `export const ssr = false; export const prerender = false;`.
- [x] `frontend/vite.config.ts`: dev proxy as in the old root `vite.config.ts` (`/api` → `http://localhost:3000`, `/ws` → ws, port 5173, host 0.0.0.0).
- [x] shadcn-svelte: `bunx shadcn-svelte@latest init`, then `add button card dialog alert-dialog input label textarea select dropdown-menu tabs badge alert switch tooltip separator skeleton table sonner`. Icons `@lucide/svelte`, theme `mode-watcher`, lightbox `photoswipe`.
- [x] `src/lib/api.ts` (port of `frontend/src/api.ts` without `sharePassword`), `src/lib/types.ts` (port without `ShareLink`/`shareable`), `src/lib/images.ts` (`srcset`, `fullSrc`, `sizesAttr`), `src/lib/stores/auth.svelte.ts` (runes class: `refresh`, `signIn`, `signOut`), `src/lib/stores/ws.svelte.ts` (port of `frontend/src/store/ws.ts`, already framework-free).
- [x] `src/routes/+layout.ts` loads onboarding status + session. `+layout.svelte`: onboarding screen if needed, redirect to `/login` if anonymous, otherwise header (brand, admin link for role admin, email, theme toggle, sign out) + `<slot>`. `src/routes/admin/+layout.ts`: redirect if not admin.
- [x] Editor settings (`.vscode`, `.zed`): `[svelte]` → Prettier, everything else stays Biome.

### Phase 4: Port the pages
The reference for each is the old Lit page in git history (`frontend/src/pages/...`).
- [x] `/login` (email + password, error display) and onboarding form (code from `?code=`, email, name, password).
- [x] `/` home: folder tree (root folders) + root albums as cards with cover, actions create/rename/delete folder, create album (title, folder). All users may do this. WS topics `folder-tree`, `album-list`.
- [x] `/folders/[id]`: breadcrumb, subfolders, albums, same actions. WS `folder:<id>`.
- [x] `/albums/[id]` view: render blocks (heading/text/gallery/group), `BlockGallery` (grid/masonry/strip), `BlockGroup` (background none/auto/neutral/blue/green/amber/rose; auto tint from photo placeholders as in `sb-block-group.ts`), one PhotoSwipe across all galleries of the album with caption element (logic from `sb-album-view.ts`). Link to edit. WS `album:<id>`.
- [x] `/albums/[id]/edit`: meta (title, description, folder, cover choice, delete with AlertDialog) + block editor (toolbar heading/text/gallery/group, drafts with save button, group assignment, HTML5 DnD reorder per sibling set as in `sb-album-blocks.ts`) + `GalleryPhotos` (multi-upload with `accept="image/*"`, reorder via DnD, inline caption, delete, dedup notice).
- [x] `/admin/users`: table, create user (email, name, password, role), change role, set password, delete. Mirror backend guards in the UI (own account, last admin).
- [x] `/admin/storage`: stats (DB, originals, variants, orphans), clear cache. WS `storage-stats`.
- [x] Toasts (sonner) for `ApiError` failures; loading skeletons; 404 page.

### Phase 5: Cleanup and docs
- [x] Remove old frontend leftovers (`dist/frontend` from the Lit build, `frontend/src/global.css` remnants), fresh `bun.lock` in root and frontend.
- [x] `README.md`: what Sammelband is, dev start (`bun run dev` + `bun run dev:frontend`), prod (`docker compose up`), onboarding flow, env variables.
- [x] `CLAUDE.md`: stack, folder layout, conventions (Biome backend / Prettier frontend, routes under `/api`, services without ORM), how to change the schema (schema.sql + delete DB while not in production).
- [x] Run the Docker build end to end once and start the container with volumes.

### Later (deliberately left out)
- ~~Share links~~ → now roadmap item 5 (public links). Granular per-folder/album permissions stay out; the old implementation is in git history.
- Real Markdown in the text block (currently paragraphs only).
- Magic link / password reset by mail.
- ~~Tests~~ and ~~migrations~~ → now roadmap items 1 and 12. Playwright for the frontend stays later.
- Backup strategy for DB + uploads (with multi-tenancy: exportable per tenant too?).

## Verification

- Phase 1: `bun run typecheck`, `bun run lint`, start the backend, run through onboarding via curl, then as a user: create folder/album/block, upload a photo, fetch a variant; as non-admin `/api/admin/users` → 403; without session `/api/images/...` → 401.
- Phase 2: `bun run build:frontend`, start the backend, a full page load of `http://localhost:3000/albums/xyz` returns `index.html`; `/_app/immutable/...` comes with the immutable cache header; `/api/nope` → 404 JSON. `docker compose build && docker compose up` runs with healthcheck.
- Phase 3/4: `bun run --cwd frontend check` (svelte-check) green; manual browser run via Vite proxy: onboarding → login → folder/album → blocks + photos → view with lightbox → admin creates user, sets password, log in as the new user and edit an album. Second tab open: changes arrive via WS.


## Status 2026-09-25

Phases 0 to 5 are done. Deviations from the plan:
- `photos.block_id` is `NOT NULL` with `ON DELETE CASCADE` on `album_blocks`.
- Deleting a folder now explicitly requires it to have no subfolders (previously just a DB error).
- Images are only served for valid filenames (`<uuid>.bin`) and cached with `Cache-Control: private`, since they're behind login.
- shadcn-svelte with the "Sera" preset (Noto Sans + Playfair Display, taupe), fitting for a photo book.
- Biome only instead of ESLint + Prettier, one `biome.json` for backend and frontend (Svelte via Biome's experimental full support).

## Status 2026-09-26

Added since the last status (not committed yet, see `git status`):
- Logo + favicon from the design canvas, theme matched to the logo colors (burgundy `#7B1E2E`, paper `#FAF6F1`), "Sammelband" as text only on login/onboarding.
- Mobile: hamburger menu; this removed the horizontal overflow (which caused the shifted PhotoSwipe lightbox). Opaque lightbox background.
- After login, return to the original page (`/login?next=…`, local paths only). Progress bar on slow navigation.
- Live updates for albums without refetch: services send `emitAlbumPatch()` with the changed rows, `AlbumState` in the album layout patches in place. Resync after WS reconnect.
- Album URLs `/albums/<slug>-<shortId>` (8 characters, column `albums.short_id`).
- Funny 404 page (polaroid with a confused face, random saying).
- Dev over Tailscale: `server.allowedHosts: [".ts.net"]` in `frontend/vite.config.ts`, start the backend with `TRUSTED_ORIGINS` for the Tailscale origins.

## Backlog: next session

### 1. Profile page
- [ ] Route `/profile`, linked from the account menu (desktop) and the hamburger menu (mobile).
- [ ] Change name, change own password (better-auth `changePassword`, ask for current password, optionally sign out other sessions).
- [ ] Avatar editor: upload, square crop with zoom/pan, round preview. Store via better-auth's `image` field or an own column; downscale the image (e.g. 256 px), don't keep the original.
- [ ] Fun presets: a set of hand-drawn animal avatars as inline SVG in the logo's style (ideas: sloth with camera, owl with reading glasses, capybara in a photo album, raccoon as photo thief, penguin with polaroid, hedgehog with film roll). Light/dark friendly.
- [ ] Show the avatar in the header instead of the user icon, fallback initials.
- [ ] 2FA: better-auth `twoFactor` plugin (TOTP). Setup with QR code + confirmation code, show/regenerate backup codes, disable with password. Extend the login flow with the TOTP step (backup code too). Tenant admin can reset a user's 2FA (`/admin/users`). Add the plugin's schema tables.

### 2. Plugin system foundation
- [ ] Carry over the decisions from the Claude session "Frontend-Framework für Sammelband-Projekt" and record them here before writing code (the details are there, not in this repo).
- [ ] What a plugin can contribute, at least: new block types (backend: content schema with zod + validation; frontend: renderer + editor component) and album actions in the overflow menu (basis for PDF export).
- [ ] Registry in backend and frontend; replace `ALLOWED_TYPES` in `block.service.ts` with the registry (the DB-level type `CHECK` is gone since the Kysely migrations).
- [ ] Plugin configuration **per tenant**, not per instance (changes the earlier design, see roadmap item 2): the tenant admin enters their own API keys/credentials, a plugin is active for a tenant once that tenant configured it. Define behavior for blocks of a disabled plugin (placeholder instead of crash).
- [ ] Run the existing block types (heading, text, gallery, group) as built-in plugins through the same interface, so the API proves itself on real cases.
- [ ] Album overflow menu ("⋯") in view and editor as the hook point for plugin actions.

### 3. Plugin: OpenStreetMap map block
- [ ] Block type `map` via the plugin system: map with OSM tiles (Leaflet or MapLibre), store viewport/zoom.
- [ ] Markers with title, optionally linked to a photo from the album; later markers automatically from the photos' EXIF GPS.
- [ ] Routes: set waypoints, choose profile (walking, bike, car), compute the route via a configurable routing service (OSRM, GraphHopper or OpenRouteService); alternatively import a GPX file. Line color/style selectable.
- [ ] Tile and routing servers configurable via env (respect the OSM tile usage policy; own tile server possible when self-hosting). Note: tile requests go to third parties.
- [ ] Think about rendering in the PDF export (render a static map image).

### 4. Plugin: PDF export (first step towards automated book printing)
- [ ] Action "Export as PDF" in the album overflow menu.
- [ ] Dialog: choose book format (e.g. A4 portrait/landscape, A5, square 21×21 and 30×30 cm), optional bleed.
- [ ] Server-side rendering, e.g. headless Chromium via a dedicated print route with print CSS, using originals instead of web variants. As a background job, progress via WebSocket.
- [ ] Store generated PDFs as export assets (own directory per tenant + table with `tenant_id`), list them in the album with download and delete; count them in the storage overview.
- [ ] Print orders (Lulu etc.) and their credentials per tenant, so costs don't get mixed.
- [ ] Prep for print providers: pad page count to an even number, bleed/crop marks, check image resolution per page and warn.

### 5. Plugin: AI assistance
- [ ] Write text: "Write with AI" / "Rephrase" in the text and heading blocks, context from album title, neighboring blocks and captions. Result as a draft that's only applied on save.
- [ ] Create albums: generate a proposal from a selection of photos (structure by date/place from EXIF, headings, short texts, gallery layouts), show a preview first and only create on confirmation.
- [ ] Suggest captions (image description via a vision model).
- [ ] Configurable provider (e.g. Claude API via API key in the tenant settings, alternatively a local model). Clearly state that photos/texts are sent to the provider; can be disabled per tenant, keys and usage kept separate per tenant.

### 6. Plugin: photos from Nextcloud (WebDAV), later Immich
- [ ] Connection per user on the profile page: WebDAV URL, user, app password. Store credentials encrypted (with `SECRET_KEY`), never return them to the frontend.
- [ ] Backend as proxy: list folders and fetch thumbnails (Nextcloud preview API), so the browser never talks to Nextcloud directly (CORS, credentials).
- [ ] Desktop editor: collapsible sidebar to browse Nextcloud folders with thumbnails; drag & drop photos into a gallery (multi-select). On drop, the backend downloads the original straight from Nextcloud and stores it like a normal upload (dedup applies).
- [ ] Mobile: instead of the sidebar, an "Add from Nextcloud" picker dialog.
- [ ] Public links (roadmap item 5) only serve from Sammelband's own storage/cache, never via a live proxy with Nextcloud/Immich credentials.
- [ ] Cut the source interface so that Immich (Immich API with API key: albums, timeline, people) can be added as a second source without rework.

## Roadmap to the first beta (planned 2026-09-27)

This plan overturns some decisions from 2026-09-25 (see "Context"):
- **Roles:** instead of `admin`/`user`, now superadmin, tenant admin and tenant user (item 2).
- **Share links** come back as public links (item 5); granular grants still don't.
- **Migrations** come back and run automatically on startup (item 1); editing `db/schema.sql` + deleting the DB only applies until then.
- **Plugin configuration** per tenant instead of per instance (backlog 2, 4, 5 adjusted).

Decided 2026-09-28: "the tenant admin sets permissions" means roles only (admin/user within the tenant); everyone in a tenant edits everything. Per-folder/album rights stay out.

Order follows dependencies: DB layer and migrations first, then multi-tenancy, since almost everything else (`tenant_id`, storage paths, links) builds on it.

### 1. Database: configurable SQL provider
- [x] Make the SQL provider configurable instead of SQLite-only: SQLite (default, `bun:sqlite` via our own small Kysely dialect) and PostgreSQL (`DATABASE_URL=postgres://…`, via `pg`, Kysely's official dialect; keeps the backend runtime-portable, see item 12). Skip MySQL for now, Postgres covers the need.
- [x] Decided: **Kysely**. One dialect-agnostic query builder; better-auth already uses Kysely internally and now shares our instance. Adding Turso/libSQL later = one case in `src/db/client.ts` plus `@libsql/kysely-libsql`. Only dialect-specific SQL: the cover trigger in `0001_initial.ts`.
- [x] Migrations run automatically on startup: better-auth's migrator for its tables, then Kysely's `Migrator` for `src/db/migrations/`. Replaces `db/schema.sql` and the `short_id` backfill. The initial migration is `IF NOT EXISTS`, so existing dev DBs adopt it as-is.
- [x] Test suite (`bun test`, 21 service tests in `test/`); `.github/workflows/ci.yml` runs lint, typecheck, svelte-check and the tests against SQLite and Postgres. The workflow hasn't run on GitHub yet (no remote).

### 2. Multi-tenancy (required for v1)
Naming: `tenant` in code, **"Sammelband"** in the UI (a Sammelband is a book binding several works together, i.e. one tenant with its albums). The app and a single tenant share the name, so docs need to tell "instance" and "Sammelband" apart.
- [x] One instance hosts multiple independent tenants (friends/family), each with its own users, folders/albums and storage, isolated from each other.
- [x] Role model:
  - **Superadmin** (instance owner, `user.superadmin`): one per installation. Has their own Sammelband with their own users (they are also tenant admin of it), and creates/deletes Sammelbände for other admins, sets GB quotas, can globally suspend a tenant. Sees storage metadata of other tenants, but none of their content. Can't be demoted or deleted; can't suspend or delete their own Sammelband.
  - **Tenant admin:** manages only their own Sammelband: creates users or invite links. Doesn't see other tenants at all. (Configuring plugins comes with the plugin system, backlog 2.)
  - **Tenant user:** regular users.
- [x] A new Sammelband's first admin gets a one-time invite link (7 days, only a hash stored) and sets their own password. Tenant admins can create invite links for their users too.
- [x] Superadmin can suspend (signs everyone out, blocks sign-in, nothing deleted) and hard-delete (users, content, files; requires typing the name).
- [x] Tenant selection: a user belongs to exactly one tenant (`user.tenantId`), resolved at login. No subdomains for v1. Emails stay unique across the instance, so a tenant admin creating a user with an email taken in another tenant learns that it exists.
- [x] Data model: `tenants`, `tenant_invites`, `tenant_id` on folders, albums, album_blocks, image_files and photos (migration `0002_tenants`; existing installs get one Sammelband owning everything, oldest admin becomes superadmin, files move). Plugin configs and links get it when they exist.
- [x] Query layer: requests run inside the user's tenant (AsyncLocalStorage); `tdb()` adds the tenant filter to every query via a Kysely plugin (WHERE, JOIN ON, subqueries) and rejects inserts for another tenant.
- [x] Storage isolation: files under `uploads/tenants/<id>/`, paths always built from the tenant in context. Dedup only within a tenant. (Generated PDFs will follow the same layout.)
- [x] Per-tenant GB quota for original photos: one conditional UPDATE reserves the bytes on upload (413 when over), deletes release them. The superadmin's **Sammelbände** page shows usage per tenant; `/admin/storage` shows the own tenant.
- [ ] Print orders (Lulu etc.) and AI/API keys stay per tenant, so costs and usage don't get mixed. (With backlog 4/5.)
- [x] Live events (`/ws`) only go to users of the same tenant.
- [x] First-run setup creates the superadmin and names their Sammelband.

### 3. Folder tiles in the library view
- [ ] Folder tiles the same size as album tiles (consistent grid, no more small list-style entries).
- [ ] A folder tile previews the covers of the albums inside (e.g. a 2×2 grid of the first albums).
- [ ] Fallbacks for fewer albums: 1 cover full size, 2 side by side, 3 as 1 large + 2 small. No covers or no albums: neutral folder placeholder in the Sammelband style.
- [ ] Keep folders distinguishable from albums (folder icon or label overlay).
- [ ] Nested folders: if a folder contains only subfolders, use the covers of those subfolders' albums (one level deep is enough).

### 4. Folder sort order
- [ ] Sort options per folder: name, created date, modified date and manual (drag & drop).
- [ ] Manual order to arrange albums chronologically, by importance or however fits (e.g. a folder for one person).
- [ ] Sort mode and manual order are stored **per user**, not globally: each user can sort the same folder differently.
- [ ] Manual order needs a persisted position per (user, folder, item) rather than just a sort key, so reordering doesn't rewrite every item (fractional or gapped positions).
- [ ] Items without a manual position (newly added albums) go to the end, sorted by a secondary key (e.g. created date).

### 5. Public links
- [ ] Share an album or folder via a public link, without the recipient needing an account.
- [ ] Links are random, unguessable tokens; tenant-scoped, bypassing login only for that one share.
- [ ] Per-link settings: optional password, optional expiry date, optional download permission (view only vs. download originals).
- [ ] Revoke a link at any time; revoking doesn't affect other links to the same content.
- [ ] Publicly shared photos are served from Sammelband's own storage/cache; never pass live Nextcloud/Immich credentials through for anonymous visitors.
- [ ] Public pages get `noindex` headers and basic rate limiting (password brute force, mass downloads).
- [ ] Consider view tracking (link opened / download count) for the owner, optional and disclosed.

### 6. Update notifications in the admin area
- [ ] Backend checks the GitHub Releases API every 12–24 h and caches the result (never from the browser).
- [ ] Current version and build commit/date are injected at build time (Docker build args / env vars).
- [ ] Channel-aware: stable compares against the latest non-prerelease; beta includes prereleases; nightly compares build date/commit and shows "newer nightly available". Note: SemVer sorts `-nightly.YYYYMMDD` above `-beta.N`, so never compare across channels.
- [ ] Banner in the admin area (superadmin only) with current vs. latest version and release notes (from the GitHub release body written by release-please).
- [ ] Setting to disable the update check (privacy); document that no data is sent.
- [ ] `semver` from npm or `Bun.semver` (Bun-specific, relevant for the Bun investigation in item 12).

### 7. First beta release
- [ ] One container image with the Bun backend and the built SvelteKit SPA (backend serves the static files). Already exists in the `Dockerfile` incl. HEALTHCHECK; make sure it stays that way.
- [ ] Multi-arch images: `linux/amd64` and `linux/arm64` (Raspberry Pi, ARM NAS).
- [ ] Updating must be easy for self-hosters: pull the new image, restart, migrations run (item 1).
- [ ] CI/CD with GitHub Actions: build images and push them to ghcr.io.
- [ ] Pre-commit hook (lefthook or husky) with lint-staged and Biome.
- [ ] Reference `docker-compose.yml` (exists with SQLite): add a commented-out Postgres variant.

### 8. Licensing (decided, modeled after Home Assistant)
- [ ] Code: Apache-2.0 (`LICENSE` in the repo root; includes patent grant and trademark clause).
- [ ] Contributions: DCO. Preferred: the DCO GitHub App checking `Signed-off-by` on every commit. Alternative: a click-through CLA bot like Home Assistant's (CLA text based on the DCO).
- [ ] Trademark: note in the README that the name "Sammelband" and the logo aren't covered by the code license.
- [ ] Docs: choose a Creative Commons license for user and dev docs.
- [ ] License check in CI (flag GPL/AGPL dependencies).

### 9. Versioning, branches & release process
- [ ] Trunk-based: `main` is the only long-lived branch and always releasable. Everything goes through PRs with required checks, squash merges. Unfinished work stays behind feature flags or in its PR.
- [ ] SemVer, staying on `0.x.y` during beta; `1.0.0` is the first stable release. `0.x` minor bumps may contain breaking changes, patch bumps are fixes/small features.
- [ ] Three channels, all built from `main`:
  - Nightly: scheduled GitHub Action (e.g. 02:00 UTC), skipped if there are no new commits since the last nightly. Version `0.x.0-nightly.YYYYMMDD`, tags `nightly` and `nightly-YYYYMMDD`. Auto-delete nightly images older than ~30 days.
  - Beta: prereleases `0.x.0-beta.N` / `0.x.0-rc.N`, tag `beta`.
  - Stable: `x.y.z`, tags `x.y.z` and `latest`.
- [ ] Conventional Commits (`feat:`, `fix:`, `feat!:` for breaking changes). Because of squash merges the PR title becomes the commit message, so check PR titles in CI.
- [ ] release-please for beta and stable: automatic release PR with version bump and changelog; merging it creates the tag, GitHub release and triggers the image build.
  - `bump-minor-pre-major: true` (breaking changes bump the minor version while on `0.x`).
  - Prerelease support (`-beta.N`) in release-please is fiddly: test early; fall back to a small manual workflow for betas if needed and use release-please for stable only.
- [ ] No patching of old versions: only the latest release is supported.
- [ ] Hotfix exception: critical bug in stable while `main` has unreleased work → branch from the release tag, release a patch, merge the fix back to `main`, delete the branch.
- [ ] Beta phase:
  - Start with a short soft freeze (~1–2 weeks): only fixes are merged to `main` during beta, feature PRs wait for the stable release.
  - Later, with more contributors: short-lived `release/x.y` branch cut at `beta.1`, cherry-pick fixes from `main`, release stable from the branch, delete it (release-please supports release branches).
  - Feature flags for large multi-PR features, regardless of the beta phase.

### 10. GitHub setup & automation
- [ ] Protect `main` (PRs only, required checks, no force push).
- [ ] Security features: Dependabot (updates and alerts), CodeQL, secret scanning, `SECURITY.md`.
- [ ] Set up sponsoring (`FUNDING.yml` / GitHub Sponsors).
- [ ] Auto-label PRs by path (actions/labeler): `docs:user`, `docs:dev`, `frontend`, `backend`, `plugin:<name>`.
- [ ] Issue and PR templates (bug report, feature request).

### 11. Documentation site (GitHub Pages)
- [ ] GitHub Pages serves one site per repo, so one Astro site with two sections (`/docs` for users, `/dev` for developers) instead of two separate sites.
- [ ] Starlight (Astro's docs theme) with the Sammelband theme (burgundy, logo).
- [ ] Deploy via GitHub Action on merge to `main`.

### 12. Quality & security
- [ ] Another thorough security review of the codebase, now including tenant isolation (check every endpoint for cross-tenant access, including `/ws` and image delivery).
- [ ] Verify `.gitignore` / `.dockerignore` cover everything (secrets, local DBs, uploads, build output).
- [ ] Set up test coverage reporting.
- [ ] Investigate how deeply the code depends on Bun and whether Bun could be replaced: list all Bun-specific APIs in use (`bun:sqlite`, `Bun.sql`, `Bun.serve`, `Bun.file`, `Bun.semver`, `hono/bun`). Hono is runtime-agnostic and runs on Bun and Node, which keeps the Bun dependency small.
