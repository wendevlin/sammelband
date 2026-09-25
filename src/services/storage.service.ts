import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";
import { db } from "../db/client";
import { emit, topics } from "../lib/events";

function dirStats(dir: string): { file_count: number; size_bytes: number } {
  try {
    const files = readdirSync(dir);
    const size_bytes = files.reduce((acc, f) => acc + (statSync(join(dir, f)).size ?? 0), 0);
    return { file_count: files.length, size_bytes };
  } catch {
    return { file_count: 0, size_bytes: 0 };
  }
}

export function getStorageStats() {
  const dbStat = (() => {
    try {
      return { size_bytes: statSync(config.DATABASE_PATH).size };
    } catch {
      return { size_bytes: 0 };
    }
  })();

  const originalsDir = join(config.UPLOADS_PATH, "originals");
  const variantsDir = join(config.UPLOADS_PATH, "variants");
  const originals = dirStats(originalsDir);
  const variants = dirStats(variantsDir);

  // Orphans: rows in image_files whose `filename` is missing on disk, and
  // files on disk with no matching row. Either is a defensive red flag.
  const dbFiles = new Set(
    (db.query("SELECT filename FROM image_files").all() as { filename: string }[]).map(
      (r) => r.filename,
    ),
  );
  const diskFiles = new Set(
    (() => {
      try {
        return readdirSync(originalsDir);
      } catch {
        return [] as string[];
      }
    })(),
  );

  let missingOnDisk = 0;
  for (const f of dbFiles) if (!diskFiles.has(f)) missingOnDisk++;
  let unknownOnDisk = 0;
  for (const f of diskFiles) if (!dbFiles.has(f)) unknownOnDisk++;

  return {
    db: { size_bytes: dbStat.size_bytes, path: config.DATABASE_PATH },
    originals,
    variants,
    orphans: {
      missing_on_disk: missingOnDisk,
      unknown_on_disk: unknownOnDisk,
    },
  };
}

export function clearVariantsCache(): { cleared: boolean } {
  const dir = join(config.UPLOADS_PATH, "variants");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  emit({ topic: topics.storageStats(), kind: "updated" });
  return { cleared: true };
}
