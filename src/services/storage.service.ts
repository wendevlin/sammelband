import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { emit, topics } from "../lib/events";
import { originalsDir, variantsDir } from "../lib/storage-paths";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { currentTenant } from "./tenant.service";

function dirStats(dir: string): { file_count: number; size_bytes: number } {
  try {
    const files = readdirSync(dir);
    const size_bytes = files.reduce((acc, f) => acc + (statSync(join(dir, f)).size ?? 0), 0);
    return { file_count: files.length, size_bytes };
  } catch {
    return { file_count: 0, size_bytes: 0 };
  }
}

/** Storage of the current tenant. */
export async function getStorageStats() {
  const originals = originalsDir(currentTenantId());
  const tenant = await currentTenant();

  // Orphans: rows in image_files whose `filename` is missing on disk, and
  // files on disk with no matching row. Either is a defensive red flag.
  const dbFiles = new Set(
    (await tdb().selectFrom("image_files").select("filename").execute()).map((r) => r.filename),
  );
  const diskFiles = new Set(
    (() => {
      try {
        return readdirSync(originals);
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
    quota: { used_bytes: tenant.storage_used_bytes, limit_bytes: tenant.quota_bytes },
    originals: dirStats(originals),
    variants: dirStats(variantsDir(currentTenantId())),
    orphans: {
      missing_on_disk: missingOnDisk,
      unknown_on_disk: unknownOnDisk,
    },
  };
}

export function clearVariantsCache(): { cleared: boolean } {
  const dir = variantsDir(currentTenantId());
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  emit({ topic: topics.storageStats(), kind: "updated" });
  return { cleared: true };
}
