import type { SourceId, SourceInfo, SourceListing, SourceSettingsInfo } from "@sammelband/shared";
import { fail } from "../lib/errors";
import { open, seal } from "../lib/secret-box";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { isSourceId, SOURCES } from "../sources";
import type { SourceFile } from "../sources/types";
import * as imageService from "./image.service";

// Photo sources of the current Sammelband: admins switch them on and configure
// them, users connect their own accounts, browse, and import into sections.

function sourceOf(id: string) {
  if (!isSourceId(id)) throw fail("source_not_found");
  return SOURCES[id];
}

async function settingRow(id: SourceId) {
  return tdb()
    .selectFrom("source_settings")
    .selectAll()
    .where("source", "=", id)
    .executeTakeFirst();
}

async function enabledConfig(id: SourceId): Promise<unknown> {
  const row = await settingRow(id);
  if (!row?.enabled) throw fail("source_disabled");
  return JSON.parse(row.config);
}

// --- Admin settings ----------------------------------------------------------

export async function listSettings(): Promise<SourceSettingsInfo[]> {
  const rows = await tdb().selectFrom("source_settings").selectAll().execute();
  const counts = await tdb()
    .selectFrom("source_accounts")
    .select(["source", (eb) => eb.fn.countAll<number>().as("n")])
    .groupBy("source")
    .execute();
  return Object.values(SOURCES).map((source) => {
    const row = rows.find((r) => r.source === source.id);
    return {
      id: source.id,
      name: source.name,
      enabled: Boolean(row?.enabled),
      config: row ? source.showConfig(JSON.parse(row.config)) : {},
      accounts: Number(counts.find((c) => c.source === source.id)?.n ?? 0),
    };
  });
}

/**
 * Switch a source on or off. Its settings are checked (Nextcloud: the server
 * answers); pointing it somewhere else drops the accounts made for the old one.
 */
export async function saveSettings(
  id: string,
  input: { enabled: boolean; config: Record<string, unknown> },
): Promise<SourceSettingsInfo> {
  const source = sourceOf(id);
  const existing = await settingRow(source.id);
  // Switching off keeps the settings as they are, even if the server is down.
  const config: unknown = input.enabled
    ? await source.parseConfig(input.config)
    : existing
      ? JSON.parse(existing.config)
      : {};
  const json = JSON.stringify(config);
  if (existing && existing.config !== json) {
    await tdb().deleteFrom("source_accounts").where("source", "=", source.id).execute();
  }
  const row = { enabled: input.enabled ? 1 : 0, config: json, updated_at: Date.now() };
  if (existing) {
    await tdb().updateTable("source_settings").set(row).where("source", "=", source.id).execute();
  } else {
    await tdb()
      .insertInto("source_settings")
      .values({ ...row, tenant_id: currentTenantId(), source: source.id })
      .execute();
  }
  const saved = (await listSettings()).find((s) => s.id === source.id);
  if (!saved) throw fail("source_not_found");
  return saved;
}

// --- Accounts ----------------------------------------------------------------

/** The sources switched on in this Sammelband, with the user's account if connected. */
export async function listForUser(userId: string): Promise<SourceInfo[]> {
  const enabled = await tdb()
    .selectFrom("source_settings")
    .select("source")
    .where("enabled", "=", 1)
    .execute();
  const accounts = await tdb()
    .selectFrom("source_accounts")
    .select(["source", "label"])
    .where("user_id", "=", userId)
    .execute();
  return enabled.flatMap(({ source }) => {
    if (!isSourceId(source)) return [];
    const account = accounts.find((a) => a.source === source);
    return [
      {
        id: source,
        name: SOURCES[source].name,
        account: account ? { label: account.label } : null,
      },
    ];
  });
}

/** The source's config for connecting an account (it must be switched on). */
export async function configFor<T>(id: SourceId): Promise<T> {
  return (await enabledConfig(id)) as T;
}

export async function saveAccount(
  userId: string,
  id: SourceId,
  label: string,
  credentials: unknown,
): Promise<SourceInfo> {
  await enabledConfig(id);
  const sealed = await seal(credentials);
  const now = Date.now();
  const existing = await tdb()
    .selectFrom("source_accounts")
    .select("id")
    .where("user_id", "=", userId)
    .where("source", "=", id)
    .executeTakeFirst();
  if (existing) {
    await tdb()
      .updateTable("source_accounts")
      .set({ label, credentials: sealed, last_location: null, updated_at: now })
      .where("id", "=", existing.id)
      .execute();
  } else {
    await tdb()
      .insertInto("source_accounts")
      .values({
        id: Bun.randomUUIDv7(),
        tenant_id: currentTenantId(),
        user_id: userId,
        source: id,
        label,
        credentials: sealed,
        last_location: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }
  return { id, name: SOURCES[id].name, account: { label } };
}

export async function removeAccount(userId: string, id: string): Promise<void> {
  const source = sourceOf(id);
  const account = await tdb()
    .selectFrom("source_accounts")
    .selectAll()
    .where("user_id", "=", userId)
    .where("source", "=", source.id)
    .executeTakeFirst();
  if (!account) return;
  await tdb().deleteFrom("source_accounts").where("id", "=", account.id).execute();
  const row = await settingRow(source.id);
  const credentials = await open(account.credentials);
  if (row && credentials) await source.revoke?.(JSON.parse(row.config), credentials);
}

/** Config and decrypted credentials for using a source as this user. */
async function connection(userId: string, id: string) {
  const source = sourceOf(id);
  const config = await enabledConfig(source.id);
  const account = await tdb()
    .selectFrom("source_accounts")
    .selectAll()
    .where("user_id", "=", userId)
    .where("source", "=", source.id)
    .executeTakeFirst();
  if (!account) throw fail("source_not_connected");
  const credentials = await open(account.credentials);
  // Sealed with another SECRET_KEY: the account has to be connected again.
  if (!credentials) throw fail("source_not_connected");
  return { source, config, credentials, account };
}

// --- Browsing and importing ----------------------------------------------------

/**
 * A folder of the user's account. Without a location it opens where the user
 * was last (or the top, if that folder is gone).
 */
export async function browse(
  userId: string,
  id: string,
  location: string | null,
): Promise<SourceListing> {
  const { source, config, credentials, account } = await connection(userId, id);
  const target = location ?? account.last_location;
  let listing: SourceListing;
  try {
    listing = await source.browse(config, credentials, target);
  } catch (err) {
    if (location !== null || target === null) throw err;
    listing = await source.browse(config, credentials, null);
  }
  if (listing.location !== account.last_location) {
    await tdb()
      .updateTable("source_accounts")
      .set({ last_location: listing.location })
      .where("id", "=", account.id)
      .execute();
  }
  return listing;
}

export async function thumbnail(
  userId: string,
  id: string,
  thumb: string,
  size: number,
): Promise<SourceFile> {
  const { source, config, credentials } = await connection(userId, id);
  return source.thumbnail(config, credentials, thumb, size);
}

/** Fetch photos from the source and add them to a section, like uploads. */
export async function importPhotos(
  userId: string,
  id: string,
  sectionId: string,
  refs: string[],
): Promise<imageService.UploadedPhoto[]> {
  const { source, config, credentials } = await connection(userId, id);
  const section = await tdb()
    .selectFrom("sections")
    .select("id")
    .where("id", "=", sectionId)
    .executeTakeFirst();
  if (!section) throw fail("section_not_found");
  const imported: imageService.UploadedPhoto[] = [];
  // In order, so the photos keep the order they were picked in.
  for (const ref of refs) {
    const file = await source.download(config, credentials, ref);
    const upload = new File([file.bytes], file.name, { type: file.type });
    imported.push(await imageService.uploadPhoto(upload, sectionId, userId));
  }
  return imported;
}
