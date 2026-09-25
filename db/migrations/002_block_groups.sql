-- Group blocks: a block may be nested one level inside a 'group' block.
--
-- Two changes to album_blocks: a nullable parent_id, and 'group' added to the
-- type CHECK. SQLite can't ALTER a CHECK, so we rebuild the table. parent_id is
-- a plain column (no self-FK): rebuilding a self-referencing table with
-- foreign_keys ON is fragile, so parent integrity and child-cascade are enforced
-- in block.service.ts. Album deletion still removes children via the album_id FK.

CREATE TABLE album_blocks_new (
  id         TEXT PRIMARY KEY,
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  parent_id  TEXT,   -- group block id when nested; NULL for top-level (app-enforced)
  sort_order REAL NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('heading','text','gallery','group')),
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO album_blocks_new
  (id, album_id, parent_id, sort_order, type, content, created_at, updated_at)
SELECT id, album_id, NULL, sort_order, type, content, created_at, updated_at
FROM album_blocks;

DROP TABLE album_blocks;
ALTER TABLE album_blocks_new RENAME TO album_blocks;

CREATE INDEX idx_blocks_album  ON album_blocks(album_id, sort_order);
CREATE INDEX idx_blocks_parent ON album_blocks(parent_id);
