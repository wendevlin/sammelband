export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  created_by: string;
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
  shareable: number;
  created_by: string;
  created_at: number;
  updated_at: number;
};

export type AlbumBlock = {
  id: string;
  album_id: string;
  parent_id: string | null;
  sort_order: number;
  type: "heading" | "text" | "gallery" | "group";
  content: string;
  created_at: number;
  updated_at: number;
};

export type Photo = {
  id: string;
  album_id: string;
  block_id: string | null;
  sort_order: number;
  image_file_id: string;
  caption: string | null;
  uploaded_by: string;
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

export const SRCSET_WIDTHS = [400, 800, 1200, 1920] as const;
export type SrcsetWidth = (typeof SRCSET_WIDTHS)[number];

export function srcset(filename: string): string {
  return SRCSET_WIDTHS.map((w) => `/api/images/${filename}?w=${w} ${w}w`).join(", ");
}

export function sizesAttr(): string {
  return "(min-width: 900px) 30vw, 100vw";
}

export function fullSrc(filename: string, width: SrcsetWidth = 1920): string {
  return `/api/images/${filename}?w=${width}`;
}
