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
  created_by: string | null;
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

export type ImageFile = {
  id: string;
  content_hash: string;
  filename: string;
  original_path: string;
  width: number;
  height: number;
  file_size: number;
  placeholder: string;
  created_at: number;
};

export type Photo = {
  id: string;
  album_id: string;
  block_id: string;
  sort_order: number;
  image_file_id: string;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: number;
};
