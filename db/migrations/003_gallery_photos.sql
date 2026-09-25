-- Galleries own their photos: each photo belongs to a gallery block (block_id)
-- and is ordered within it (sort_order). Replaces the old album-pool + per-block
-- photo_ids model. No data backfill — pre-existing pool photos keep block_id NULL
-- and simply stop displaying.

ALTER TABLE photos ADD COLUMN block_id TEXT;
ALTER TABLE photos ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;

CREATE INDEX idx_photos_block ON photos(block_id, sort_order);
