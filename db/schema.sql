-- Sammelband schema. Applied idempotently on every start (src/db/client.ts).
-- There are no migrations while the app is not in production use: to change the
-- schema, edit this file and delete the dev database.

-- better-auth tables (singular names, camelCase columns — better-auth defaults)
CREATE TABLE IF NOT EXISTS user (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image         TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id        TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token     TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_userId ON session(userId);

CREATE TABLE IF NOT EXISTS account (
  id                    TEXT PRIMARY KEY,
  accountId             TEXT NOT NULL,
  providerId            TEXT NOT NULL,
  userId                TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken           TEXT,
  refreshToken          TEXT,
  idToken               TEXT,
  accessTokenExpiresAt  INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope                 TEXT,
  password              TEXT,
  createdAt             INTEGER NOT NULL,
  updatedAt             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_userId ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  INTEGER NOT NULL,
  createdAt  INTEGER NOT NULL,
  updatedAt  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

-- Domain tables --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);

CREATE TABLE IF NOT EXISTS albums (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL,
  description    TEXT,
  folder_id      TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  cover_photo_id TEXT,  -- cleared by trg_photos_clear_cover
  created_by     TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (folder_id, slug)
);
-- SQLite treats NULLs as distinct in UNIQUE, so root-level slugs need this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_albums_root_slug ON albums(slug) WHERE folder_id IS NULL;

-- Blocks may be nested one level inside a 'group' block. parent_id integrity
-- and child cascade are enforced in block.service.ts.
CREATE TABLE IF NOT EXISTS album_blocks (
  id         TEXT PRIMARY KEY,
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  parent_id  TEXT,
  sort_order REAL NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('heading', 'text', 'gallery', 'group')),
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_album  ON album_blocks(album_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_blocks_parent ON album_blocks(parent_id);

-- Deduplicated image files on disk (by content hash).
CREATE TABLE IF NOT EXISTS image_files (
  id            TEXT PRIMARY KEY,
  content_hash  TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  original_path TEXT NOT NULL,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  file_size     INTEGER NOT NULL,
  placeholder   TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Photos belong to a gallery block and are ordered within it.
CREATE TABLE IF NOT EXISTS photos (
  id            TEXT PRIMARY KEY,
  album_id      TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  block_id      TEXT NOT NULL REFERENCES album_blocks(id) ON DELETE CASCADE,
  sort_order    REAL NOT NULL,
  image_file_id TEXT NOT NULL REFERENCES image_files(id),
  caption       TEXT,
  uploaded_by   TEXT REFERENCES user(id) ON DELETE SET NULL,
  uploaded_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_album   ON photos(album_id);
CREATE INDEX IF NOT EXISTS idx_photos_block   ON photos(block_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_photos_imgfile ON photos(image_file_id);

CREATE TRIGGER IF NOT EXISTS trg_photos_clear_cover
AFTER DELETE ON photos
BEGIN
  UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = OLD.id;
END;
