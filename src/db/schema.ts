// Row types for the domain tables, plus the Kysely `Database` interface. The
// tables themselves are created by src/db/migrations (domain) and better-auth's
// migrator (user, session, account, verification).

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
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

export type AlbumBlock = {
  id: string;
  tenant_id: string;
  album_id: string;
  parent_id: string | null;
  sort_order: number;
  type: "heading" | "text" | "gallery" | "group";
  content: string;
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
  block_id: string;
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
};

export type TenantInvite = {
  id: string;
  tenant_id: string;
  token_hash: string;
  role: "admin" | "user";
  expires_at: number;
  used_at: number | null;
  created_at: number;
};

/** The columns of better-auth's tables that app code touches directly. */
type UserTable = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  tenantId: string | null;
  superadmin: boolean | number; // SQLite returns 0/1
  createdAt: string | Date;
  updatedAt: string | Date;
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
  folders: Folder;
  albums: Album;
  album_blocks: AlbumBlock;
  image_files: ImageFile;
  photos: Photo;
};
