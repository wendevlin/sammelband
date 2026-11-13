import {
  BUILTIN_PROFILES,
  builtinProfile,
  type ExportProfile,
  type ExportProfileSnapshot,
  type ExportProfileSpec,
  type ExportPurpose,
} from "@sammelband/shared";
import { z } from "zod";
import { db } from "../db/client";
import type { ExportProfileRow } from "../db/schema";
import { fail } from "../lib/errors";
import { emit, topics } from "../lib/events";
import { exportProfileSpecSchema } from "../lib/export-profile-schema";
import { currentTenantId, tdb } from "../lib/tenant-context";

// Print profiles of the current Sammelband: the built-in ones (shared
// export.ts), minus those its admins switched off, plus its own. Exports are
// made with a profile that is switched on; they keep a copy of it, so
// changing or deleting a profile never changes a PDF that exists.

/** PDF export is switched on in this Sammelband. */
export async function exportEnabled(): Promise<boolean> {
  const tenant = await db
    .selectFrom("tenants")
    .select("pdf_export_enabled")
    .where("id", "=", currentTenantId())
    .executeTakeFirst();
  return Boolean(tenant?.pdf_export_enabled);
}

const idList = z.array(z.string());

async function disabledBuiltins(): Promise<Set<string>> {
  const tenant = await db
    .selectFrom("tenants")
    .select("disabled_export_profiles")
    .where("id", "=", currentTenantId())
    .executeTakeFirst();
  try {
    return new Set(idList.parse(JSON.parse(tenant?.disabled_export_profiles ?? "[]")));
  } catch {
    return new Set();
  }
}

async function saveDisabledBuiltins(ids: Set<string>): Promise<void> {
  // Only ids that exist, so the list doesn't keep what was removed from the code.
  const known = [...ids].filter((id) => builtinProfile(id)).sort();
  await db
    .updateTable("tenants")
    .set({ disabled_export_profiles: JSON.stringify(known) })
    .where("id", "=", currentTenantId())
    .execute();
}

/** A stored spec, or null if it no longer passes the checks (it is then unusable). */
function parseSpec(json: string): ExportProfileSpec | null {
  try {
    const parsed = exportProfileSpecSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toProfile(row: ExportProfileRow): ExportProfile | null {
  const spec = parseSpec(row.spec);
  if (!spec) return null;
  return { id: row.id, builtin: false, name: row.name, enabled: Boolean(row.enabled), spec };
}

async function ownRows(): Promise<ExportProfileRow[]> {
  return tdb().selectFrom("export_profiles").selectAll().orderBy("created_at").execute();
}

async function ownRow(id: string): Promise<ExportProfileRow> {
  const row = await tdb()
    .selectFrom("export_profiles")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) throw fail("export_profile_not_found");
  return row;
}

function changed(): void {
  emit({ topic: topics.exportProfiles(), kind: "updated" });
}

/** Admins: every profile, switched on or off; built-in ones first. */
export async function listProfiles(): Promise<ExportProfile[]> {
  const disabled = await disabledBuiltins();
  const builtins: ExportProfile[] = BUILTIN_PROFILES.map((p) => ({
    id: p.id,
    builtin: true,
    name: null,
    enabled: !disabled.has(p.id),
    spec: p.spec,
  }));
  const own = (await ownRows()).flatMap((row) => toProfile(row) ?? []);
  return [...builtins, ...own];
}

/** The profiles an export can be made with now (none while PDF export is off). */
export async function usableProfiles(): Promise<ExportProfile[]> {
  if (!(await exportEnabled())) return [];
  return (await listProfiles()).filter((p) => p.enabled);
}

/** A profile to export with, as the export keeps it; throws if it can't be used. */
export async function usableProfile(id: string): Promise<ExportProfileSnapshot> {
  const builtin = builtinProfile(id);
  if (builtin) {
    if ((await disabledBuiltins()).has(id)) throw fail("export_profile_disabled");
    return { id, builtin: true, name: null, spec: builtin.spec };
  }
  const row = await tdb()
    .selectFrom("export_profiles")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  const profile = row && toProfile(row);
  if (!profile) throw fail("export_profile_not_found");
  if (!profile.enabled) throw fail("export_profile_disabled");
  return { id, builtin: false, name: profile.name, spec: profile.spec };
}

export async function createProfile(input: {
  name: string;
  spec: ExportProfileSpec;
}): Promise<ExportProfile> {
  const now = Date.now();
  const row: ExportProfileRow = {
    id: Bun.randomUUIDv7(),
    tenant_id: currentTenantId(),
    name: input.name.trim(),
    spec: JSON.stringify(exportProfileSpecSchema.parse(input.spec)),
    enabled: 1,
    created_at: now,
    updated_at: now,
  };
  await tdb().insertInto("export_profiles").values(row).execute();
  changed();
  return toProfile(row) as ExportProfile;
}

export async function updateProfile(
  id: string,
  patch: { name?: string; spec?: ExportProfileSpec },
): Promise<ExportProfile> {
  if (builtinProfile(id)) throw fail("export_profile_builtin");
  await ownRow(id);
  await tdb()
    .updateTable("export_profiles")
    .set({
      ...(patch.name !== undefined && { name: patch.name.trim() }),
      ...(patch.spec !== undefined && {
        spec: JSON.stringify(exportProfileSpecSchema.parse(patch.spec)),
      }),
      updated_at: Date.now(),
    })
    .where("id", "=", id)
    .execute();
  changed();
  const profile = toProfile(await ownRow(id));
  if (!profile) throw fail("export_profile_not_found");
  return profile;
}

/** Delete an own profile; PDFs made with it keep their copy of it. */
export async function deleteProfile(id: string): Promise<void> {
  if (builtinProfile(id)) throw fail("export_profile_builtin");
  await ownRow(id);
  await tdb().deleteFrom("export_profiles").where("id", "=", id).execute();
  changed();
}

/** Switch one profile on or off. */
export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  if (builtinProfile(id)) {
    const disabled = await disabledBuiltins();
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    await saveDisabledBuiltins(disabled);
  } else {
    await ownRow(id);
    await tdb()
      .updateTable("export_profiles")
      .set({ enabled: enabled ? 1 : 0 })
      .where("id", "=", id)
      .execute();
  }
  changed();
}

/** Switch every profile of a purpose (print shop, home, screen) on or off. */
export async function setPurposeEnabled(purpose: ExportPurpose, enabled: boolean): Promise<void> {
  const disabled = await disabledBuiltins();
  for (const p of BUILTIN_PROFILES) {
    if (p.spec.purpose !== purpose) continue;
    if (enabled) disabled.delete(p.id);
    else disabled.add(p.id);
  }
  await saveDisabledBuiltins(disabled);
  const own = (await ownRows()).filter((row) => parseSpec(row.spec)?.purpose === purpose);
  if (own.length > 0) {
    await tdb()
      .updateTable("export_profiles")
      .set({ enabled: enabled ? 1 : 0 })
      .where(
        "id",
        "in",
        own.map((row) => row.id),
      )
      .execute();
  }
  changed();
}
