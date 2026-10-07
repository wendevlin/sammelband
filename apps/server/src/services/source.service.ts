import type {
  SourceAccount,
  SourceId,
  SourceInfo,
  SourceListing,
  SourceSettingsInfo,
} from "@sammelband/shared";
import type { SourceAccount as AccountRow } from "../db/schema";
import { fail } from "../lib/errors";
import { open, seal } from "../lib/secret-box";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { isSourceId, SOURCES } from "../sources";
import type { SourceFile } from "../sources/types";
import * as imageService from "./image.service";

// Photo sources of the current Sammelband: admins switch them on with a default
// server, users connect accounts (several, on any allowed server, with an
// optional name), browse them and import into sections.

function sourceOf(id: string) {
  if (!isSourceId(id)) throw fail("source_not_found");
  return SOURCES[id];
}

function settingRow(id: SourceId) {
  return tdb()
    .selectFrom("source_settings")
    .selectAll()
    .where("source", "=", id)
    .executeTakeFirst();
}

async function requireEnabled(id: SourceId) {
  const row = await settingRow(id);
  if (!row?.enabled) throw fail("source_disabled");
  return row;
}

function toAccount(row: AccountRow): SourceAccount {
  const source = sourceOf(row.source);
  return {
    id: row.id,
    source: source.id,
    name: row.name,
    label: row.label,
    server: source.serverOf(JSON.parse(row.config)),
    start_location: row.start_location,
  };
}

const hasValues = (input: Record<string, unknown>) =>
  Object.values(input).some((v) => typeof v === "string" && v.trim() !== "");

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
    const config = row ? JSON.parse(row.config) : {};
    return {
      id: source.id,
      name: source.name,
      enabled: Boolean(row?.enabled),
      config: hasValues(config) ? source.showConfig(config) : {},
      accounts: Number(counts.find((c) => c.source === source.id)?.n ?? 0),
    };
  });
}

/**
 * Switch a source on or off. A default server is optional and checked when
 * given; accounts keep their own servers, so changing it doesn't touch them.
 */
export async function saveSettings(
  id: string,
  input: { enabled: boolean; config: Record<string, unknown> },
): Promise<SourceSettingsInfo> {
  const source = sourceOf(id);
  const existing = await settingRow(source.id);
  // Switching off keeps the settings as they are, even if the server is down.
  let config: unknown = existing ? JSON.parse(existing.config) : {};
  if (input.enabled) config = hasValues(input.config) ? await source.parseConfig(input.config) : {};
  const row = {
    enabled: input.enabled ? 1 : 0,
    config: JSON.stringify(config),
    updated_at: Date.now(),
  };
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

/** The sources switched on in this Sammelband, with the user's accounts there. */
export async function listForUser(userId: string): Promise<SourceInfo[]> {
  const enabled = await tdb()
    .selectFrom("source_settings")
    .selectAll()
    .where("enabled", "=", 1)
    .execute();
  const accounts = await tdb()
    .selectFrom("source_accounts")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .execute();
  return enabled.flatMap((row) => {
    if (!isSourceId(row.source)) return [];
    const source = SOURCES[row.source];
    const config = JSON.parse(row.config);
    return [
      {
        id: source.id,
        name: source.name,
        default_server: hasValues(config) ? source.serverOf(config) : null,
        accounts: accounts.filter((a) => a.source === source.id).map(toAccount),
      },
    ];
  });
}

/**
 * The config for connecting an account: the server the user typed (checked),
 * else the admins' default. The source must be switched on.
 */
export async function configFor<T>(id: SourceId, input: Record<string, unknown> = {}): Promise<T> {
  const row = await requireEnabled(id);
  if (hasValues(input)) return (await SOURCES[id].parseConfig(input)) as T;
  const config = JSON.parse(row.config);
  if (!hasValues(config)) throw fail("source_invalid_url");
  return config as T;
}

const cleanName = (name: string | null | undefined) => name?.trim().slice(0, 100) || null;

export async function addAccount(
  userId: string,
  id: SourceId,
  input: { name?: string | null; label: string; config: unknown; credentials: unknown },
): Promise<SourceAccount> {
  await requireEnabled(id);
  const now = Date.now();
  const row: AccountRow = {
    id: Bun.randomUUIDv7(),
    tenant_id: currentTenantId(),
    user_id: userId,
    source: id,
    name: cleanName(input.name),
    label: input.label,
    config: JSON.stringify(input.config),
    credentials: await seal(input.credentials),
    start_location: null,
    created_at: now,
    updated_at: now,
  };
  await tdb().insertInto("source_accounts").values(row).execute();
  return toAccount(row);
}

/** One of the user's own accounts. */
async function ownAccount(userId: string, accountId: string): Promise<AccountRow> {
  const row = await tdb()
    .selectFrom("source_accounts")
    .selectAll()
    .where("id", "=", accountId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!row) throw fail("source_account_not_found");
  return row;
}

/**
 * Rename an account or choose the folder its picker opens in (checked, so it
 * has to exist; the top is stored as null).
 */
export async function updateAccount(
  userId: string,
  accountId: string,
  input: { name?: string | null; start_location?: string | null },
): Promise<SourceAccount> {
  const row = await ownAccount(userId, accountId);
  const changes: Partial<AccountRow> = { updated_at: Date.now() };
  if (input.name !== undefined) changes.name = cleanName(input.name);
  if (input.start_location !== undefined) {
    let location: string | null = null;
    if (input.start_location !== null) {
      const { source, config, credentials } = await connection(userId, accountId);
      location = (await source.browse(config, credentials, input.start_location)).location;
    }
    changes.start_location = location === "/" ? null : location;
  }
  await tdb().updateTable("source_accounts").set(changes).where("id", "=", row.id).execute();
  return toAccount({ ...row, ...changes });
}

/** Remove an account here and, best effort, revoke its access at the source. */
export async function removeAccount(userId: string, accountId: string): Promise<void> {
  const row = await ownAccount(userId, accountId);
  await tdb().deleteFrom("source_accounts").where("id", "=", row.id).execute();
  const credentials = await open(row.credentials);
  if (credentials) await sourceOf(row.source).revoke?.(JSON.parse(row.config), credentials);
}

/** An account ready to use: its source (switched on), config and decrypted credentials. */
async function connection(userId: string, accountId: string) {
  const account = await ownAccount(userId, accountId);
  const source = sourceOf(account.source);
  await requireEnabled(source.id);
  const credentials = await open(account.credentials);
  // Sealed with another SECRET_KEY: the account has to be connected again.
  if (!credentials) throw fail("source_auth_failed");
  return { source, config: JSON.parse(account.config), credentials, account };
}

// --- Browsing and importing ----------------------------------------------------

/**
 * A folder of the account. Without a location it opens in the account's start
 * folder (or the top, if that folder is gone).
 */
export async function browse(
  userId: string,
  accountId: string,
  location: string | null,
): Promise<SourceListing> {
  const { source, config, credentials, account } = await connection(userId, accountId);
  const target = location ?? account.start_location;
  try {
    return await source.browse(config, credentials, target);
  } catch (err) {
    if (location !== null || target === null) throw err;
    return source.browse(config, credentials, null);
  }
}

export async function thumbnail(
  userId: string,
  accountId: string,
  thumb: string,
  size: number,
): Promise<SourceFile> {
  const { source, config, credentials } = await connection(userId, accountId);
  return source.thumbnail(config, credentials, thumb, size);
}

/** Fetch photos from an account and add them to a section, like uploads. */
export async function importPhotos(
  userId: string,
  accountId: string,
  sectionId: string,
  refs: string[],
): Promise<imageService.UploadedPhoto[]> {
  const { source, config, credentials } = await connection(userId, accountId);
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
