# Sammelband: Abspecken + Umstieg auf SvelteKit-SPA

## Kontext

Sammelband ist ein self-hosted, blockbasiertes Fotobuch (Ordner → Alben → Blöcke → Fotos). Der bisherige MVP-Scope (granulare Freigaben, Share-Links mit Passwort, Magic Links, SQL-Migrationen) ist zu groß für den aktuellen Stand: das Ding wird noch nicht benutzt. Ziel ist ein leichter Kern, den man wirklich fertig kriegt, plus ein Frontend-Neubau auf SvelteKit + shadcn-svelte als reine SPA, die das Bun-Backend ausliefert.

Getroffene Entscheidungen (mit dir abgestimmt):
- **Rollen:** nur `admin` und `user`. Jeder eingeloggte User sieht und editiert alle Ordner und Alben. Admin verwaltet zusätzlich User. Keine Grants, keine Share-Links, keine öffentliche Ansicht.
- **Login:** nur E-Mail + Passwort. Magic Link, Passwort-Reset per Mail, SMTP/nodemailer fliegen raus. Admin setzt Passwörter.
- **HTTP-Framework:** Wechsel von Elysia (installiert ist 1.4.28, 2.0 mit Breaking Changes angekündigt) auf **Hono**. Gründe: stabile API seit v4, Bun-nativ (`hono/bun` für WebSocket-Upgrade und Static Files), Validierung über `@hono/zod-validator` + `zod`, offizielle better-auth-Integration. NestJS verworfen: Node/Express-zentriert, DI/Module/Gateways sind für ~35 Routen zu viel Zeremonie. Die Services sind framework-frei und bleiben unverändert; nur Routen, Middleware und `index.ts` werden umgeschrieben.
- **WebSocket Live-Updates:** bleiben, aber für alle eingeloggten User statt nur Admins.
- **DB:** keine Migrationen mehr. Ein `db/schema.sql`, das beim Start idempotent angewendet wird. Bestehende Dev-DB wird verworfen.
- **Frontend:** SvelteKit (Svelte 5, Runes) + shadcn-svelte + Tailwind v4, `adapter-static` mit SPA-Fallback, `ssr = false`. Eigenes Package in `frontend/`. Backend serviert `dist/frontend`.

## Ist-Zustand (Analyse)

**Stack:** Bun 1.4 + Elysia 1.2 + better-auth 1.2 + `bun:sqlite` direkt (kein ORM; `kysely` ist in `package.json`, wird aber nirgends importiert). Frontend: Lit 3 + Web Awesome + PhotoSwipe, Vite 6, eigener Mini-Router. Kein git-Repo, keine Tests, kein CLAUDE.md.

**Backend (`src/`, ~2.900 Zeilen):**
- `index.ts`: Elysia-App, alle HTTP-Routen unter `/api`, `/ws`, `/health`. **Serviert das Frontend nicht** (kein Static-Handler); `Dockerfile` baut das Frontend auch nicht. → SPA-Serving ist komplett neu zu bauen.
- `auth.ts`: better-auth mit `emailAndPassword` + `magicLink`-Plugin + `sendResetPassword`, `mailer.ts` (nodemailer, Dev-Fallback auf Konsole). `user.role` als additionalField (`input: false`).
- `middleware/auth.middleware.ts`: `adminRouter()` (Session + role admin + Origin/CSRF-Check) und `userRouter()` (nur Session, kein CSRF-Check). Alle Schreib-Routen sind admin-only.
- `db/client.ts`: SQLite mit WAL/FK, Migrations-Runner über `db/migrations/*.sql` und `_migrations`-Tabelle. Drei Migrationen (initial, block groups, gallery-owned photos). `db/schema.ts` hat nur TS-Typen.
- Domain-Services (gut und behaltenswert): `folder.service` (Baum, Zyklus-Check, Delete nur wenn leer), `album.service` (Slug pro Ordner, Cover explizit oder erstes Bild, `attachCovers`), `block.service` (heading/text/gallery/group, eine Ebene Nesting, fraktionale `sort_order` pro Parent), `image.service` (SHA-256-Dedup in `image_files`, Bun.Image Varianten 400/800/1200/1920 webp/jpeg mit Cache, Placeholder, Disk-Cleanup dedup-aware), `storage.service` (Stats, Orphan-Zähler, Cache leeren), `onboarding.service` (Bootstrap-Code beim ersten Start → erster Admin).
- Zu entfernen: `access.service` (rekursive CTEs für Grant-Vererbung), `grant.service`, `share.service` (Token, argon2-Passwort, Ablauf, Revoke), `lib/signed-cookie.ts` (sb_share-Cookie), `routes/share.ts`, `routes/admin/shares.ts`, `routes/admin/grants.ts`, Share-Cookie-Pfad in `routes/images.ts`, `albums.shareable`.
- `lib/events.ts` + `routes/ws.ts`: In-Process Pub/Sub, Topics `folder-tree`, `album-list`, `folder:<id>`, `album:<id>`, `photo-pool:<id>`, `storage-stats` (+ share/access-Topics, die wegfallen). WS-Upgrade prüft aktuell role admin.
- `rate-limit.middleware.ts`: einfache IP-Buckets für Auth und Upload. Behalten.

**Frontend (`frontend/src`, ~4.000 Zeilen Lit):** Seiten login, onboarding, home (Ordnerbaum + Alben), folder-view, album-view (PhotoSwipe über alle Galerien des Albums, Gruppen mit Auto-Hintergrund aus Fotofarben), share-view, admin-home (Ordner/Alben CRUD), admin-users, album-edit (Meta, Cover, Tabs: Blöcke-Editor mit HTML5-DnD, Galerie-Fotos Upload/Reorder/Caption, Access, Shares), storage. `store/ws.ts` (Reconnect mit Backoff, Subscription-Replay) und `api.ts` sind framework-unabhängig und lassen sich fast 1:1 übernehmen. Web Awesome und Lit fallen komplett weg.

**DB-Schema (Zielzustand nach Abspecken):** `user`, `session`, `account`, `verification` (better-auth), `folders`, `albums` (ohne `shareable`), `album_blocks` (mit `parent_id`, type CHECK inkl. `group`), `image_files`, `photos` (`block_id NOT NULL`), Trigger `trg_photos_clear_cover`. Weg: `share_links`, `album_access`, `folder_access`, `_migrations`. `created_by`/`uploaded_by` werden nullable mit `ON DELETE SET NULL`, damit Admins User löschen können.

## Ziel-API

Alle Content-Routen brauchen eine Session (jeder User), Schreibzugriffe zusätzlich den Origin-Check. `admin`-Routen brauchen role admin.

| Bereich | Routen |
|---|---|
| Auth | `/api/auth/sign-in/email`, `/api/auth/sign-out`, `/api/auth/get-session` (better-auth; `sign-up` bleibt gesperrt) |
| Onboarding | `GET /api/onboarding/status`, `POST /api/onboarding/claim` |
| Ordner | `GET /api/folders`, `POST /api/folders`, `GET /api/folders/:id` (Ordner + Unterordner + Alben mit Cover), `PATCH /api/folders/:id`, `DELETE /api/folders/:id` |
| Alben | `GET /api/albums`, `POST /api/albums`, `GET /api/albums/:id` (Album + Blöcke + Fotos), `PATCH /api/albums/:id`, `DELETE /api/albums/:id`, `POST /api/albums/:id/cover` |
| Blöcke | `GET/POST /api/albums/:id/blocks`, `PATCH/DELETE /api/albums/:id/blocks/:blockId`, `POST /api/albums/:id/blocks/reorder` |
| Fotos | `POST /api/blocks/:blockId/photos` (Upload, rate-limited), `POST /api/blocks/:blockId/photos/reorder`, `PATCH /api/photos/:id`, `DELETE /api/photos/:id` |
| Bilder | `GET /api/images/:filename?w=400\|800\|1200\|1920&format=webp\|jpeg`; ohne `w` → Original |
| Admin | `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id` (name, role), `POST /api/admin/users/:id/password`, `DELETE /api/admin/users/:id`, `GET /api/admin/storage`, `POST /api/admin/storage/clear-cache` |
| WS | `/ws` für alle eingeloggten User |
| SPA | alles andere → `dist/frontend` (Assets) bzw. `index.html` (Fallback) |

## Tasks

### Phase 0: Housekeeping
- [x] `git init`, `.gitignore` prüfen (bereits ok: db, uploads, dist, .env), Ist-Stand als ersten Commit sichern. Damit bleibt das alte Lit-Frontend als Referenz in der History.
- [x] `TASKS.md` (dieser Plan) ins Repo.
- [x] Lokale `sammelband.db*` und `uploads/` leeren (Dev-Daten, Schema ändert sich).
- [x] Deps aus root `package.json` entfernen: `kysely` (ungenutzt), `nodemailer`, `@types/nodemailer`, `elysia`; neu `hono`, `@hono/zod-validator`, `zod`. Frontend-Deps (`lit`, `@awesome.me/webawesome`, `photoswipe`, `vite`) wandern in Phase 3 ins Frontend-Package.

### Phase 1: Backend abspecken
- [x] **Schema statt Migrationen.** `db/migrations/` löschen, `db/schema.sql` anlegen (Zielschema oben, alles `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `CREATE TRIGGER IF NOT EXISTS`). In `src/db/client.ts` `runMigrations()` durch `initSchema()` ersetzen, das die Datei einmal per `db.exec` ausführt. `_migrations`-Tabelle raus. `src/db/schema.ts`: `ShareLink` und `shareable` entfernen, `block_id: string`, `created_by: string | null`.
- [x] **Auth vereinfachen.** `src/auth.ts`: `magicLink`-Plugin und `sendResetPassword` raus. `src/mailer.ts` löschen. `src/config.ts`: `SMTP`-Block raus, `.env.example`, `docker-compose*.yml` entsprechend kürzen.
- [x] **Elysia → Hono.** `src/index.ts`: `new Hono<{ Variables: { user: AuthUser } }>()`, Start über `Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch, websocket })`. `app.onError` mappt `AppError` → `{ error }` mit Status, alles andere → 500 (Ersatz für den heutigen `onError` in `index.ts`). better-auth nach offizieller Hono-Anleitung: `app.on(["GET","POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))`, davor eine Middleware, die `POST /api/auth/sign-up/email` mit 403 blockt, und der Auth-Rate-Limiter. Validierung: `zValidator("json" | "param" | "query" | "form", schema)` statt `t.*`; die Schemas 1:1 aus den bisherigen `t.Object`-Definitionen übersetzen. Upload: `c.req.parseBody({ all: true })`, `files` kann `File | File[]` sein. Rate-Limit-Middleware (`rate-limit.middleware.ts`) als Hono-Middleware portieren (Logik bleibt). Handler, die heute `Response` zurückgeben (`serveVariant`, `serveOriginal`), gehen in Hono unverändert.
- [x] **Middleware.** `src/middleware/auth.middleware.ts` als Hono-Middlewares: `requireAuth` (Session via `auth.api.getSession({ headers: c.req.raw.headers })`, setzt `c.set("user", ...)`, sonst 401) und `requireAdmin` (401/403). CSRF: `hono/csrf` mit `origin: [BASE_URL, dev: localhost:5173]` global vor allen `/api`-Schreibrouten, damit auch User-Schreibzugriffe geschützt sind (heute nur bei `adminRouter`). Pro Router: `router.use("*", requireAuth)` bzw. `requireAdmin`.
- [x] **Shares/Grants/Access entfernen.** Löschen: `src/services/share.service.ts`, `grant.service.ts`, `access.service.ts`, `src/lib/signed-cookie.ts`, `src/routes/share.ts`, `src/routes/admin/shares.ts`, `src/routes/admin/grants.ts`. Aus `routes/images.ts` den Share-Cookie-Pfad und `isAuthorized` streichen (nur noch: Session vorhanden?). `folder.service.deleteFolder`: `DELETE FROM share_links/folder_access` raus. `album.service`: `shareable` überall raus.
- [x] **Routen umziehen.** `src/routes/admin/{folders,albums,blocks,photos}.ts` → `src/routes/{folders,albums,blocks,photos}.ts` als je ein `new Hono()` mit `requireAuth`, eingehängt über `app.route("/api/folders", folders)` usw., Prefix `/admin` weg. `src/routes/user.ts` auflösen: die Read-Routen in die jeweiligen Dateien, `getAlbumDetail` nach `album.service`. Die Helfer `listFolderContents`/`folderExists` aus `access.service` nach `folder.service`. `adminImageRoutes` (`/admin/images/:filename`) weg, stattdessen `w` optional in `/api/images/:filename`. `src/index.ts` entsprechend neu verdrahten; `/api/admin/users/by-email` entfällt.
- [x] **User-Verwaltung ausbauen.** `src/routes/admin/users.ts`: `PATCH` erlaubt `name` + `role`; neu `POST /:id/password` (Hash über `auth.$context` → `password.hash` + `internalAdapter.updatePassword`), `DELETE /:id`. Guards: nicht sich selbst löschen, letzten Admin weder löschen noch degradieren. Passwort-Änderung invalidiert Sessions des Users (`DELETE FROM session WHERE userId`).
- [x] **WebSocket.** `src/routes/ws.ts` auf `createBunWebSocket()` aus `hono/bun`: `app.get("/ws", requireAuth, upgradeWebSocket((c) => ({ onOpen, onMessage, onClose })))`, das `websocket`-Objekt geht an `Bun.serve`. Subscription-Map pro Verbindung im Closure statt in `ws.data.store`. Admin-Check weg (Session reicht), Topic-Patterns `share-links:*` und `access:*` raus, Wire-Protokoll bleibt gleich (das Frontend-`ws.ts` muss nicht angepasst werden).
- [x] `bun run typecheck` + `bun run lint` grün; Smoke-Test per curl (Onboarding → Login → Ordner/Album/Block/Upload/Bild).

### Phase 2: Backend serviert die SPA + Docker
- [x] `src/config.ts`: `FRONTEND_DIST` (Default `./dist/frontend`).
- [x] `src/routes/spa.ts`: als letztes in `index.ts` einhängen. `/api/*` und `/ws` ohne Treffer → 404 JSON. Dann `serveStatic({ root: FRONTEND_DIST })` aus `hono/bun` mit `onFound`, das für `/_app/immutable/*` `Cache-Control: public, max-age=31536000, immutable` setzt. Fallback `app.get("*")` liefert `index.html` mit `Cache-Control: no-cache` (Path-Traversal übernimmt `serveStatic`). Wenn kein Dist existiert (Dev ohne Build): 404 mit Hinweis.
- [x] `Dockerfile`: Stage `frontend-build` (bun install im `frontend/`, `bun run build`), Ergebnis nach `/app/dist/frontend` in die Production-Stage kopieren. `db/` → `db/schema.sql`. Root `vite.config.ts` löschen.
- [x] Root `package.json`-Scripts: `dev` (Backend), `dev:frontend` → `bun run --cwd frontend dev`, `build:frontend` → `bun run --cwd frontend build`, `build` = beides. `biome.json`: `frontend/**` ausschließen (Svelte formatiert Prettier, siehe Phase 3). `tsconfig.json`: `db/**/*.ts` aus `include` raus.

### Phase 3: SvelteKit-Grundgerüst
- [x] Altes `frontend/` löschen (liegt in git), neu scaffolden: `bunx sv create frontend` (Svelte 5, TypeScript, minimal, Add-ons prettier + eslint + tailwindcss), `bunx sv add`-Äquivalente nach Bedarf. `@sveltejs/adapter-static` mit `pages`/`assets` → `../dist/frontend`, `fallback: 'index.html'`. `src/routes/+layout.ts`: `export const ssr = false; export const prerender = false;`.
- [x] `frontend/vite.config.ts`: Dev-Proxy wie im bisherigen root `vite.config.ts` (`/api` → `http://localhost:3000`, `/ws` → ws, Port 5173, host 0.0.0.0).
- [x] shadcn-svelte: `bunx shadcn-svelte@latest init`, dann `add button card dialog alert-dialog input label textarea select dropdown-menu tabs badge alert switch tooltip separator skeleton table sonner`. Icons `@lucide/svelte`, Theme `mode-watcher`, Lightbox `photoswipe`.
- [x] `src/lib/api.ts` (Port von `frontend/src/api.ts` ohne `sharePassword`), `src/lib/types.ts` (Port ohne `ShareLink`/`shareable`), `src/lib/images.ts` (`srcset`, `fullSrc`, `sizesAttr`), `src/lib/stores/auth.svelte.ts` (Runes-Klasse: `refresh`, `signIn`, `signOut`), `src/lib/stores/ws.svelte.ts` (Port von `frontend/src/store/ws.ts`, ist bereits framework-frei).
- [x] `src/routes/+layout.ts` lädt Onboarding-Status + Session. `+layout.svelte`: Onboarding-Screen wenn nötig, Redirect auf `/login` wenn anonym, sonst Header (Brand, Admin-Link bei role admin, E-Mail, Theme-Toggle, Sign out) + `<slot>`. `src/routes/admin/+layout.ts`: Redirect wenn nicht admin.
- [x] Editor-Settings (`.vscode`, `.zed`): `[svelte]` → Prettier, Rest bleibt Biome.

### Phase 4: Seiten portieren
Referenz ist jeweils die alte Lit-Seite in der git-History (`frontend/src/pages/...`).
- [x] `/login` (E-Mail + Passwort, Fehleranzeige) und Onboarding-Formular (Code aus `?code=`, E-Mail, Name, Passwort).
- [x] `/` Home: Ordnerbaum (Root-Ordner) + Root-Alben als Cards mit Cover, Aktionen Ordner anlegen/umbenennen/löschen, Album anlegen (Titel, Ordner). Alle User dürfen das. WS-Topics `folder-tree`, `album-list`.
- [x] `/folders/[id]`: Breadcrumb, Unterordner, Alben, gleiche Aktionen. WS `folder:<id>`.
- [x] `/albums/[id]` Ansicht: Blöcke rendern (heading/text/gallery/group), `BlockGallery` (grid/masonry/strip), `BlockGroup` (Hintergrund none/auto/neutral/blue/green/amber/rose; Auto-Tint aus den Foto-Placeholdern wie in `sb-block-group.ts`), ein PhotoSwipe über alle Galerien des Albums mit Caption-Element (Logik aus `sb-album-view.ts`). Link auf Bearbeiten. WS `album:<id>`.
- [x] `/albums/[id]/edit`: Meta (Titel, Beschreibung, Ordner, Cover-Wahl, Löschen mit AlertDialog) + Block-Editor (Toolbar Heading/Text/Gallery/Group, Drafts mit Save-Button, Gruppenzuordnung, HTML5-DnD-Reorder pro Sibling-Set wie in `sb-album-blocks.ts`) + `GalleryPhotos` (Multi-Upload mit `accept="image/*"`, Reorder per DnD, Caption inline, Löschen, Dedup-Hinweis).
- [x] `/admin/users`: Tabelle, User anlegen (E-Mail, Name, Passwort, Rolle), Rolle ändern, Passwort setzen, Löschen. Guards aus dem Backend im UI spiegeln (eigener Account, letzter Admin).
- [x] `/admin/storage`: Stats (DB, Originale, Varianten, Orphans), Cache leeren. WS `storage-stats`.
- [x] Toasts (sonner) für Fehler aus `ApiError`; Loading-Skeletons; 404-Seite.

### Phase 5: Aufräumen und Doku
- [x] Alte Frontend-Reste (`dist/frontend` aus dem Lit-Build, `frontend/src/global.css`-Reste) weg, `bun.lock` in root und frontend frisch.
- [x] `README.md`: Was ist Sammelband, Dev-Start (`bun run dev` + `bun run dev:frontend`), Prod (`docker compose up`), Onboarding-Ablauf, Env-Variablen.
- [x] `CLAUDE.md`: Stack, Ordnerstruktur, Konventionen (Biome Backend / Prettier Frontend, Routen unter `/api`, Services ohne ORM), wie man Schema ändert (schema.sql + DB löschen solange nicht produktiv).
- [x] Docker-Build einmal komplett durchlaufen lassen und Container mit Volumes starten.

### Später (bewusst rausgelassen)
- Share-Links (öffentlich, optional Passwort/Ablauf) und granulare Rechte pro Ordner/Album: wenn nötig als Feature auf den dann stabilen Kern aufsetzen; die alte Implementierung liegt in der git-History.
- Echtes Markdown im Text-Block (aktuell nur Absätze).
- Magic Link / Passwort-Reset per Mail.
- Tests (bun test für Services; Playwright fürs Frontend).
- Sobald produktiv: Migrationen wieder einführen (dann mit Versionierung), Backup-Strategie für DB + Uploads.

## Verifikation

- Phase 1: `bun run typecheck`, `bun run lint`, Backend starten, Onboarding per curl durchspielen, danach als User: Ordner/Album/Block anlegen, Foto hochladen, Variante abrufen; als Nicht-Admin `/api/admin/users` → 403; ohne Session `/api/images/...` → 401.
- Phase 2: `bun run build:frontend`, Backend starten, `http://localhost:3000/albums/xyz` per Full-Page-Load liefert `index.html`; `/_app/immutable/...` kommt mit immutable-Cache-Header; `/api/nope` → 404 JSON. `docker compose build && docker compose up` läuft mit Healthcheck.
- Phase 3/4: `bun run --cwd frontend check` (svelte-check) grün; manueller Durchlauf im Browser über Vite-Proxy: Onboarding → Login → Ordner/Album → Blöcke + Fotos → Ansicht mit Lightbox → Admin User anlegen, Passwort setzen, als neuer User einloggen und Album editieren. Zweiter Tab offen: Änderungen kommen per WS an.


## Stand 2026-09-25

Phasen 0 bis 5 sind umgesetzt. Abweichungen vom Plan:
- `photos.block_id` ist `NOT NULL` mit `ON DELETE CASCADE` auf `album_blocks`.
- Ordner löschen verlangt jetzt auch explizit, dass keine Unterordner mehr drin sind (vorher nur DB-Fehler).
- Bilder werden nur noch mit gültigem Dateinamen (`<uuid>.bin`) ausgeliefert und mit `Cache-Control: private` gecacht, weil sie hinter dem Login liegen.
- shadcn-svelte mit dem Preset „Sera“ (Noto Sans + Playfair Display, Taupe), passend für ein Fotobuch.
- Nur Biome statt ESLint + Prettier, eine `biome.json` für Backend und Frontend (Svelte über Biomes experimentellen Full-Support).
