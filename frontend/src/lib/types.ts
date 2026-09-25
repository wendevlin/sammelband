export type Role = "admin" | "user";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
};

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

export type FolderContents = {
  folder: Folder;
  folders: Folder[];
  albums: Album[];
};

export type StorageStats = {
  db: { size_bytes: number; path: string };
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
