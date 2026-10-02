// Row types for the domain tables, plus the Kysely `Database` interface. The
// tables themselves are created by src/db/migrations (domain) and better-auth's
// migrator (user, session, account, verification).

import type { Role, SortMode } from "@sammelband/shared";

export type Folder = {
  id: string;
  tenant_id: string;
  name: string;
  parent_id: string | null;
  created_by: string | null;
  created_at: number;
};

export type Album = {
  id: string;
  tenant_id: string;
  title: string;
  slug: string;
  short_id: string;
  description: string | null;
  folder_id: string | null;
  cover_photo_id: string | null;
  /** Kept up to date by imageService.albumChanged(). */
  cover_filename: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

/** A part of an album; photos point at it with `section_id`. */
export type Section = {
  id: string;
  tenant_id: string;
  album_id: string;
  sort_order: number;
  title: string;
  /** Markdown. */
  text: string;
  /** 0/1: border and tinted background. */
  highlight: number;
  created_at: number;
  updated_at: number;
};

export type ImageFile = {
  id: string;
  tenant_id: string;
  content_hash: string;
  filename: string;
  width: number;
  height: number;
  file_size: number;
  placeholder: string;
  created_at: number;
};

export type Photo = {
  id: string;
  tenant_id: string;
  album_id: string;
  section_id: string;
  sort_order: number;
  image_file_id: string;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: number;
};

/** A Sammelband: an isolated set of users, folders, albums and photos. */
export type Tenant = {
  id: string;
  name: string;
  quota_bytes: number | null; // null = unlimited
  storage_used_bytes: number; // originals only
  suspended_at: number | null;
  created_at: number;
  /** IANA zone, e.g. "Europe/Vienna": share links expire at the end of a day here. */
  timezone: string;
  /** 0/1: every user must set up two-factor authentication. */
  two_factor_required: number;
};

/** A photo source switched on for a Sammelband; `config` is JSON (per source). */
export type SourceSetting = {
  tenant_id: string;
  source: string;
  enabled: number;
  config: string;
  updated_at: number;
};

/** A user's account at a photo source; `credentials` is encrypted JSON. */
export type SourceAccount = {
  id: string;
  tenant_id: string;
  user_id: string;
  source: string;
  label: string;
  credentials: string;
  last_location: string | null;
  created_at: number;
  updated_at: number;
};

/** Instance-wide settings of the superadmin; `value` is JSON. */
export type InstanceSetting = {
  key: string;
  value: string;
};

export type TenantInvite = {
  id: string;
  tenant_id: string;
  token_hash: string;
  role: Role;
  expires_at: number;
  used_at: number | null;
  created_at: number;
};

export type { SortMode };

/** A user's sort mode for one container: "root" or a folder id. */
export type FolderSort = {
  tenant_id: string;
  user_id: string;
  folder_key: string;
  mode: SortMode;
};

export type AlbumPosition = {
  tenant_id: string;
  user_id: string;
  album_id: string;
  position: number;
};

export type FolderPosition = {
  tenant_id: string;
  user_id: string;
  folder_id: string;
  position: number;
};

/** A public link to an album or a folder (with its sub-folders). */
export type ShareLink = {
  id: string;
  tenant_id: string;
  token: string;
  album_id: string | null;
  folder_id: string | null;
  password_hash: string | null;
  expires_at: number | null;
  created_by: string | null;
  created_at: number;
};

/** The columns of better-auth's tables that app code touches directly. */
type UserTable = {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string | null;
  superadmin: boolean | number; // SQLite returns 0/1
  /** Avatar URL (better-auth's field), set by the profile service. */
  image: string | null;
  /** UI language, null = follow the browser. */
  locale: string | null;
  /** Set by better-auth's twoFactor plugin once a code was verified. */
  twoFactorEnabled: boolean | number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

/** better-auth's twoFactor plugin: the TOTP secret and backup codes (encrypted). */
type TwoFactorTable = {
  id: string;
  userId: string;
};

/** Only the columns app code reads: trusted-device records of the twoFactor plugin. */
type VerificationTable = {
  id: string;
  identifier: string;
  value: string;
};

type SessionTable = {
  id: string;
  userId: string;
};

type AccountTable = {
  id: string;
  userId: string;
};

export type Database = {
  tenants: Tenant;
  tenant_invites: TenantInvite;
  user: UserTable;
  session: SessionTable;
  account: AccountTable;
  verification: VerificationTable;
  twoFactor: TwoFactorTable;
  instance_settings: InstanceSetting;
  folders: Folder;
  albums: Album;
  sections: Section;
  image_files: ImageFile;
  photos: Photo;
  folder_sort: FolderSort;
  album_positions: AlbumPosition;
  folder_positions: FolderPosition;
  share_links: ShareLink;
  source_settings: SourceSetting;
  source_accounts: SourceAccount;
};
