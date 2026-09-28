export type Role = "admin" | "user";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** The instance owner; can't be demoted or deleted. */
  superadmin: boolean;
  createdAt: string;
};

/** The signed-in user's Sammelband (a tenant in the API). */
export type TenantInfo = {
  id: string;
  name: string;
  quota_bytes: number | null;
  storage_used_bytes: number;
};

/** A Sammelband as the instance owner sees it: metadata, never content. */
export type TenantOverview = TenantInfo & {
  suspended_at: number | null;
  created_at: number;
  own: boolean;
  user_count: number;
  album_count: number;
  invite_pending: boolean;
};

export type InstanceOverview = {
  database: { type: "sqlite" | "postgres"; size_bytes: number };
  tenants: TenantOverview[];
};

export type CreatedInvite = { url: string; role: Role; expiresAt: number };

export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  created_by: string | null;
  created_at: number;
};

export type Album = {
  id: string;
  title: string;
  slug: string;
  /** URL id; album links are /albums/<slug>-<short_id> (see $lib/links). */
  short_id: string;
  description: string | null;
  folder_id: string | null;
  cover_photo_id: string | null;
  /** Resolved cover image filename (explicit cover or first image); list endpoints only. */
  cover_filename?: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

export type BlockType = "heading" | "text" | "gallery" | "group";

export type AlbumBlock = {
  id: string;
  album_id: string;
  parent_id: string | null;
  sort_order: number;
  type: BlockType;
  /** JSON-encoded block content, see the *Content types below. */
  content: string;
  created_at: number;
  updated_at: number;
};

export type HeadingContent = { level?: number; text?: string };
export type TextContent = { markdown?: string };
export type GalleryLayout = "grid" | "masonry" | "strip";
export type GalleryContent = { layout?: GalleryLayout };
export type GroupBackground = "none" | "auto" | "neutral" | "blue" | "green" | "amber" | "rose";
export type GroupContent = { background?: GroupBackground };

export type Photo = {
  id: string;
  album_id: string;
  block_id: string;
  sort_order: number;
  image_file_id: string;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: number;
  filename: string;
  width: number;
  height: number;
  placeholder: string;
};

export type AlbumDetail = {
  album: Album;
  blocks: AlbumBlock[];
  photos: Photo[];
};

/** Album change pushed over /ws: full rows to upsert by id, and removed ids. */
export type AlbumPatch = {
  album?: Album;
  blocks?: AlbumBlock[];
  photos?: Photo[];
  removedBlocks?: string[];
  removedPhotos?: string[];
};

export type FolderContents = {
  folder: Folder;
  folders: Folder[];
  albums: Album[];
};

export type StorageStats = {
  quota: { used_bytes: number; limit_bytes: number | null };
  originals: { file_count: number; size_bytes: number };
  variants: { file_count: number; size_bytes: number };
  orphans: { missing_on_disk: number; unknown_on_disk: number };
};

export function parseContent<T>(block: AlbumBlock): T {
  try {
    return JSON.parse(block.content) as T;
  } catch {
    return {} as T;
  }
}
