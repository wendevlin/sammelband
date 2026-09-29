# Roadmap

Open work, roughly in order. Finished work lives in the git history, not here.

## Decisions that shape what's next

- Permissions stay roles only (superadmin, tenant admin, tenant user); everyone in a
  Sammelband edits everything. No per-folder or per-album rights.
- Plugins are configured per Sammelband, not per instance: the tenant admin enters their
  own API keys and credentials, so costs and usage never mix between Sammelbände. The same
  goes for print orders (Lulu etc.).
- Public links serve resized images from Sammelband's own storage only: no originals, no
  zip download, never a live proxy to Nextcloud or Immich with someone's credentials.

## Before the first beta

### Release
- [ ] Multi-arch images: `linux/amd64` and `linux/arm64` (Raspberry Pi, ARM NAS).
- [ ] CI/CD with GitHub Actions: build images and push them to ghcr.io.
- [ ] Updating stays easy for self-hosters: pull the new image, restart, migrations run.
- [ ] `docker-compose.yml`: add a commented-out Postgres variant.
- [ ] Pre-commit hook (lefthook or husky) with lint-staged and Biome.

### Versioning and release process
- [ ] Trunk-based: `main` is the only long-lived branch and always releasable. PRs with
  required checks, squash merges; unfinished work stays behind feature flags or in its PR.
- [ ] SemVer, `0.x.y` during beta, `1.0.0` is the first stable release. `0.x` minor bumps
  may break, patch bumps are fixes and small features.
- [ ] Three channels, all built from `main`:
  - Nightly: scheduled action (e.g. 02:00 UTC), skipped without new commits. Version
    `0.x.0-nightly.YYYYMMDD`, tags `nightly` and `nightly-YYYYMMDD`; delete images older
    than ~30 days.
  - Beta: prereleases `0.x.0-beta.N` / `0.x.0-rc.N`, tag `beta`.
  - Stable: `x.y.z`, tags `x.y.z` and `latest`.
- [ ] Conventional Commits (`feat:`, `fix:`, `feat!:`). With squash merges the PR title
  becomes the commit message, so CI checks PR titles.
- [ ] release-please for beta and stable (release PR with version bump and changelog;
  merging it tags, releases and triggers the image build), with
  `bump-minor-pre-major: true`. Its prerelease support is fiddly: test early, fall back to
  a small manual workflow for betas if needed.
- [ ] Only the latest release is supported. Hotfix for stable while `main` has unreleased
  work: branch from the tag, release a patch, merge the fix back, delete the branch.
- [ ] Beta phase: a short soft freeze (~1–2 weeks, fixes only). Later, with more
  contributors, a short-lived `release/x.y` branch from `beta.1` with cherry-picked fixes.

### Licensing (modeled after Home Assistant)
- [ ] Code under Apache-2.0 (`LICENSE` exists; includes patent grant and trademark clause).
- [ ] Contributions via DCO: the DCO GitHub App checks `Signed-off-by`. Alternative: a
  click-through CLA bot with a DCO-based text.
- [ ] README note: the name "Sammelband" and the logo aren't covered by the code license.
- [ ] A Creative Commons license for the docs.
- [ ] License check in CI (flag GPL/AGPL dependencies).

### GitHub setup
- [ ] Protect `main` (PRs only, required checks, no force push).
- [ ] Dependabot (updates and alerts), CodeQL, secret scanning (`SECURITY.md` exists).
- [ ] Sponsoring (`FUNDING.yml` / GitHub Sponsors).
- [ ] Auto-label PRs by path (actions/labeler): `docs:user`, `docs:dev`, `web`, `server`,
  `plugin:<name>`.
- [ ] Issue and PR templates (bug report, feature request).
- [ ] Once the repo is public, move the items of this file into GitHub Issues and keep only
  the direction here.

## Features

### Profile
- [ ] Avatar crop with zoom and pan instead of the automatic centered crop.
- [ ] Preset avatars: hand-drawn animals as inline SVG in the logo's style (sloth with
  camera, owl with reading glasses, capybara in a photo album, raccoon as photo thief,
  penguin with polaroid, hedgehog with film roll). Light/dark friendly.
- [ ] 2FA with better-auth's `twoFactor` plugin (TOTP): setup with QR code and confirmation
  code, backup codes (show, regenerate), disable with password, TOTP or backup code step
  at login. Tenant admins can reset a user's 2FA. Adds the plugin's tables.

### Plugin system
- [ ] First carry over the decisions from the Claude session "Frontend-Framework für
  Sammelband-Projekt" (the details are there, not in this repo).
- [ ] A plugin contributes at least: block types (server: content schema with zod; web:
  renderer and editor component) and album actions in the overflow menu.
- [ ] Registries on server and web; the registry replaces `ALLOWED_TYPES` in
  `block.service.ts`.
- [ ] Per-Sammelband configuration (see decisions); a plugin is active once configured.
  Blocks of a disabled plugin render a placeholder instead of crashing.
- [ ] The built-in block types (heading, text, gallery, group) run through the same
  interface, so it proves itself on real cases.
- [ ] Album overflow menu ("⋯") in view and editor as the hook for plugin actions.

### Plugin: map block (OpenStreetMap)
- [ ] Block type `map` with OSM tiles (Leaflet or MapLibre), stored viewport and zoom.
- [ ] Markers with title, optionally linked to an album photo; later from the photos'
  EXIF GPS.
- [ ] Routes: waypoints with a profile (walking, bike, car) via a configurable routing
  service (OSRM, GraphHopper, OpenRouteService), or a GPX import. Line color and style.
- [ ] Tile and routing servers configurable (respect the OSM tile usage policy; own tile
  server possible). Tile requests go to third parties, so the CSP in `index.ts` needs them.
- [ ] A static map image for the PDF export.

### Plugin: PDF export (first step towards printed books)
- [ ] "Export as PDF" in the album overflow menu.
- [ ] Dialog: book format (A4 portrait/landscape, A5, square 21×21 and 30×30 cm), optional
  bleed.
- [ ] Server-side rendering, e.g. headless Chromium on a print route with print CSS, from
  the originals. Runs as a background job with progress over the WebSocket.
- [ ] Generated PDFs as export assets (directory per tenant, table with `tenant_id`), listed
  in the album with download and delete, counted in the storage overview.
- [ ] Print provider prep: even page count, bleed and crop marks, warn about low image
  resolution per page.

### Plugin: AI assistance
- [ ] "Write with AI" / "Rephrase" in text and heading blocks, with context from the album
  title, neighboring blocks and captions. The result is a draft until saved.
- [ ] Album proposal from a photo selection (structure by date and place from EXIF,
  headings, short texts, gallery layouts); preview first, created only on confirmation.
- [ ] Caption suggestions via a vision model.
- [ ] Configurable provider (e.g. Claude API key in the tenant settings, or a local model).
  Say clearly that photos and texts go to the provider; can be disabled per Sammelband.

### Plugin: photos from Nextcloud (WebDAV), later Immich
- [ ] Connection per user on the profile page: WebDAV URL, user, app password. Stored
  encrypted (with `SECRET_KEY`), never sent to the browser.
- [ ] The server proxies folder listings and thumbnails (Nextcloud preview API), so the
  browser never talks to Nextcloud (CORS, credentials).
- [ ] Desktop editor: collapsible sidebar with Nextcloud folders; drag photos into a
  gallery (multi-select). On drop the server fetches the original and stores it like an
  upload (dedup applies).
- [ ] Mobile: an "Add from Nextcloud" picker dialog instead of the sidebar.
- [ ] Cut the source interface so Immich (API key: albums, timeline, people) can follow
  without rework.

### Smaller features
- [ ] Real Markdown in the text block (paragraphs only today).
- [ ] Public links: view tracking (opens, downloads), optional.
- [ ] Password reset by mail and magic links (needs SMTP).
- [ ] Backups of database and uploads, possibly exportable per Sammelband.

## After the first release

### Update notifications in the admin area
Easier to build once there's a real GitHub release to test against.
- [ ] The server checks the GitHub Releases API every 12–24 h and caches the result (never
  from the browser).
- [ ] Version and build commit/date injected at build time (Docker build args).
- [ ] Channel-aware: stable compares against the latest non-prerelease, beta includes
  prereleases, nightly compares build date/commit. SemVer sorts `-nightly.YYYYMMDD` above
  `-beta.N`, so never compare across channels.
- [ ] Banner for the superadmin with current vs. latest version and the release notes.
- [ ] A setting to turn the check off; document that no data is sent.

### Translations
- [ ] Connect a community translation platform (Weblate preferred, Tolgee possible) to
  `apps/web/messages`; document how to contribute a language.
- [ ] Locale-aware formatting beyond dates (numbers, file sizes).

### Documentation site (GitHub Pages)
- [ ] One Astro site with Starlight and the Sammelband theme: `/docs` for users, `/dev`
  for developers. Deployed by a GitHub Action on merge to `main`.

## Quality

- [ ] Test coverage reporting.
- [ ] Playwright tests for the web app.
- [ ] How deeply the server depends on Bun: list the Bun-specific APIs in use
  (`bun:sqlite`, `Bun.serve`, `Bun.file`/`Bun.write`, `hono/bun`, `Bun.CryptoHasher`).
  Hono runs on Bun and Node, which keeps the dependency small.
