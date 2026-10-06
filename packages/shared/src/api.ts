// What the API sends: the JSON shapes of /api responses and /ws album patches.
// The server's services return these types, the web app reads them. Rows of
// signed-in endpoints may carry more columns (e.g. tenant_id) than listed here.

export type Role = "admin" | "user";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** The instance owner; can't be demoted or deleted. */
  superadmin: boolean;
  /** Avatar URL, or null. */
  image: string | null;
  /** Signs in with a code from an authenticator app. */
  twoFactorEnabled: boolean;
  createdAt: string;
};

/** The signed-in user's Sammelband (a tenant in the API). */
export type TenantInfo = {
  id: string;
  name: string;
  quota_bytes: number | null;
  storage_used_bytes: number;
  /** IANA zone that share-link expiry dates refer to. */
  timezone: string;
  /** Its admins require two-factor authentication of every user. */
  two_factor_required: boolean;
  /** The instance owner requires it of every user on the instance. */
  two_factor_required_by_instance: boolean;
};

/** A Sammelband as the instance owner sees it: metadata, never content. */
export type TenantOverview = TenantInfo & {
  suspended_at: number | null;
  created_at: number;
  own: boolean;
  user_count: number;
  album_count: number;
  /** An unused, unexpired admin invite exists. */
  invite_pending: boolean;
};

export type InstanceOverview = {
  database: { type: "sqlite" | "postgres"; size_bytes: number };
  /** Every user on the instance must use two-factor authentication. */
  two_factor_required: boolean;
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
  /** URL id; album links are /albums/<slug>-<short_id>. */
  short_id: string;
  description: string | null;
  folder_id: string | null;
  cover_photo_id: string | null;
  /** Resolved cover image filename (explicit cover or first image). */
  cover_filename: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
};

/**
 * A part of an album: an optional title, text (Markdown) and a gallery of the
 * photos whose `section_id` points here. Highlighted sections get a border and
 * a tinted background.
 */
export type Section = {
  id: string;
  album_id: string;
  sort_order: number;
  title: string;
  text: string;
  highlight: boolean;
  created_at: number;
  updated_at: number;
};

/** A photo of an album: its row plus the image's metadata. */
export type Photo = {
  id: string;
  album_id: string;
  section_id: string;
  sort_order: number;
  image_file_id: string;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: number;
  filename: string;
  width: number;
  height: number;
  /** Tiny blurred preview, shown while the image loads. */
  placeholder: string;
};

export type AlbumDetail = {
  album: Album;
  sections: Section[];
  photos: Photo[];
};

/**
 * What changed in an album, as full rows. Clients replace rows by id and drop
 * removed ids, so applying a patch twice or out of order is harmless.
 */
export type AlbumPatch = {
  album?: Album;
  sections?: Section[];
  photos?: Photo[];
  removedSections?: string[];
  removedPhotos?: string[];
};

/** A folder as a library tile: up to four album covers as a preview, plus counts. */
export type FolderTile = Folder & {
  /** Cover filenames of its albums (or of its sub-folders' albums), newest first. */
  covers: string[];
  album_count: number;
  folder_count: number;
  /** Latest change: its creation or an edit of an album directly inside. */
  modified_at: number;
};

/** How a user orders a folder's contents; stored per user and folder. */
export type SortMode = "name" | "created" | "modified" | "manual";

export type LibraryContents = {
  folders: FolderTile[];
  albums: Album[];
  sort: SortMode;
};

export type FolderContents = LibraryContents & { folder: Folder };

export type StorageStats = {
  quota: { used_bytes: number; limit_bytes: number | null };
  originals: { file_count: number; size_bytes: number };
  variants: { file_count: number; size_bytes: number };
  orphans: { missing_on_disk: number; unknown_on_disk: number };
};

/** A public link to an album or folder, as its owners see it. */
export type ShareLinkInfo = {
  id: string;
  url: string;
  has_password: boolean;
  expires_at: number | null;
  created_at: number;
  created_by_name: string | null;
};

// --- Public links (GET /api/public/:token): trimmed rows, no user or tenant ids.

export type SharedAlbum = Pick<Album, "id" | "title" | "description" | "short_id">;
export type SharedSection = Pick<Section, "id" | "sort_order" | "title" | "text" | "highlight">;
export type SharedPhoto = Pick<
  Photo,
  "id" | "section_id" | "sort_order" | "caption" | "filename" | "width" | "height" | "placeholder"
>;
export type SharedTile = Pick<
  FolderTile,
  "id" | "name" | "covers" | "album_count" | "folder_count"
>;
export type SharedAlbumCard = SharedAlbum & { cover_filename: string | null };
export type Crumb = { id: string; name: string };

/** What a public link shows. */
export type SharedView =
  | { status: "locked" }
  | {
      status: "ok";
      kind: "album";
      album: SharedAlbum;
      sections: SharedSection[];
      photos: SharedPhoto[];
      /** Folders from the shared folder down to this album (folder shares only). */
      trail: Crumb[];
    }
  | {
      status: "ok";
      kind: "folder";
      folder: Crumb;
      folders: SharedTile[];
      albums: SharedAlbumCard[];
      /** Folders from the shared folder down to this one. */
      trail: Crumb[];
    };

// --- Photo sources (/api/sources): places to import photos from besides uploads.

export type SourceId = "nextcloud";

/** One of the user's accounts at a source; a user can connect several. */
export type SourceAccount = {
  id: string;
  source: SourceId;
  /** What the user called it ("Family", "Work"), or null. */
  name: string | null;
  /** The account at the source, e.g. the Nextcloud login name. */
  label: string;
  /** The server it's on. */
  server: string;
  /** Where the picker opens (a folder ref), or null for the top. */
  start_location: string | null;
};

/** A source switched on for the user's Sammelband, with the user's accounts there. */
export type SourceInfo = {
  id: SourceId;
  name: string;
  /** The server the admins suggest (Nextcloud: its address), or null. */
  default_server: string | null;
  accounts: SourceAccount[];
};

/** A folder on the way to the current one (breadcrumbs). */
export type SourceCrumb = { ref: string; name: string };

/** A folder to open. The rest is what the source tells about it, null if nothing. */
export type SourceFolder = SourceCrumb & {
  /** Files and folders directly inside. */
  files: number | null;
  folders: number | null;
  /** Bytes, everything inside. */
  size: number | null;
  modified: number | null;
};

export type SourceImage = {
  /** What to import: pass it to POST /api/sections/:id/import with the account. */
  ref: string;
  name: string;
  /** For GET /api/sources/accounts/:id/thumbnail?id=…, or null without a preview. */
  thumb: string | null;
  size: number | null;
  modified: number | null;
};

/** One folder of a source: where it is, what's inside. */
export type SourceListing = {
  location: string;
  /** From the top down to this folder, which is the last one. */
  crumbs: SourceCrumb[];
  folders: SourceFolder[];
  images: SourceImage[];
};

/** A source as the Sammelband's admins configure it. */
export type SourceSettingsInfo = {
  id: SourceId;
  name: string;
  enabled: boolean;
  /** Per source; Nextcloud: { url }, the default server people can change. */
  config: Record<string, string>;
  /** Accounts connected in this Sammelband. */
  accounts: number;
};
