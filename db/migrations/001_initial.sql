-- better-auth tables (singular names, camelCase columns — matches better-auth defaults)
CREATE TABLE user (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image         TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  createdAt     INTEGER NOT NULL,
  updatedAt     INTEGER NOT NULL
);

CREATE TABLE session (
  id        TEXT PRIMARY KEY,
  expiresAt INTEGER NOT NULL,
  token     TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_userId ON session(userId);

CREATE TABLE account (
  id                       TEXT PRIMARY KEY,
  accountId                TEXT NOT NULL,
  providerId               TEXT NOT NULL,
  userId                   TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken              TEXT,
  refreshToken             TEXT,
  idToken                  TEXT,
  accessTokenExpiresAt     INTEGER,
  refreshTokenExpiresAt    INTEGER,
  scope                    TEXT,
  password                 TEXT,
  createdAt                INTEGER NOT NULL,
  updatedAt                INTEGER NOT NULL
);

CREATE INDEX idx_account_userId ON account(userId);

CREATE TABLE verification (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  INTEGER NOT NULL,
  createdAt  INTEGER NOT NULL,
  updatedAt  INTEGER NOT NULL
);

CREATE INDEX idx_verification_identifier ON verification(identifier);

-- Domain tables --------------------------------------------------------------

CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_folders_parent ON folders(parent_id);

CREATE TABLE albums (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL,
  description    TEXT,
  folder_id      TEXT REFERENCES folders(id) ON DELETE RESTRICT,
  cover_photo_id TEXT,   -- FK added later (photos defined below); see CHECK below
  shareable      INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT NOT NULL REFERENCES user(id),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (folder_id, slug)
);

-- Root-level (folder_id IS NULL) slug uniqueness: SQLite treats NULL as distinct
-- in UNIQUE constraints, so we need a partial index.
CREATE UNIQUE INDEX idx_albums_root_slug
  ON albums(slug) WHERE folder_id IS NULL;

CREATE TABLE image_files (
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

CREATE TABLE photos (
  id            TEXT PRIMARY KEY,
  album_id      TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  image_file_id TEXT NOT NULL REFERENCES image_files(id),
  caption       TEXT,
  uploaded_by   TEXT NOT NULL REFERENCES user(id),
  uploaded_at   INTEGER NOT NULL
);

CREATE INDEX idx_photos_album    ON photos(album_id);
CREATE INDEX idx_photos_imgfile  ON photos(image_file_id);

-- albums.cover_photo_id FK can only be added now that photos exists.
-- SQLite cannot ALTER TABLE ADD CONSTRAINT, so we rely on triggers/application
-- logic to keep this in sync. ON DELETE SET NULL is enforced via trigger:
CREATE TRIGGER trg_photos_clear_cover
AFTER DELETE ON photos
BEGIN
  UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = OLD.id;
END;

CREATE TABLE album_blocks (
  id         TEXT PRIMARY KEY,
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  sort_order REAL NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('heading','text','gallery')),
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_blocks_album ON album_blocks(album_id, sort_order);

CREATE TABLE share_links (
  id            TEXT PRIMARY KEY,
  token         TEXT NOT NULL UNIQUE,
  album_id      TEXT REFERENCES albums(id) ON DELETE CASCADE,
  folder_id     TEXT REFERENCES folders(id) ON DELETE CASCADE,
  created_by    TEXT NOT NULL REFERENCES user(id),
  password_hash TEXT,
  expires_at    INTEGER,
  revoked_at    INTEGER,
  created_at    INTEGER NOT NULL,
  CHECK (
    (album_id IS NOT NULL AND folder_id IS NULL) OR
    (album_id IS NULL AND folder_id IS NOT NULL)
  )
);

CREATE INDEX idx_share_token ON share_links(token);

CREATE TABLE album_access (
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL REFERENCES user(id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, user_id)
);

CREATE TABLE folder_access (
  folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  granted_by TEXT NOT NULL REFERENCES user(id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (folder_id, user_id)
);
