// Every error the API reports to clients, by stable code. Responses carry
// `{ error, code, params }`: the frontend translates `code` (messages
// `error_<code>` in apps/web/messages) and falls back to `error`, the English
// text below. Codes are part of the API: add new ones, don't rename.

type Params = Record<string, string | number>;
type Entry = { status: number; message: string | ((p: never) => string) };

export const ERRORS = {
  // General
  unauthorized: { status: 401, message: "Please sign in" },
  forbidden: { status: 403, message: "You don't have access to this" },
  not_found: { status: 404, message: "Not found" },
  internal_error: { status: 500, message: "Something went wrong on the server" },
  invalid_input: {
    status: 400,
    message: (p: { details: string }) => `Invalid input: ${p.details}`,
  },
  rate_limited: {
    status: 429,
    message: (p: { retryAfter: number }) => `Too many requests. Try again in ${p.retryAfter} s.`,
  },

  // Sign-in, setup, invites
  signup_disabled: {
    status: 403,
    message: "Public sign-up is disabled. Ask an admin to create your account.",
  },
  tenant_suspended: { status: 403, message: "This Sammelband is suspended" },
  setup_completed: { status: 410, message: "Setup is already completed" },
  setup_not_active: { status: 410, message: "Setup is not active" },
  invalid_setup_code: { status: 401, message: "Invalid setup code" },
  invite_invalid: { status: 404, message: "This invite link is invalid or has expired" },
  mail_disabled: { status: 404, message: "This server doesn't send email" },

  // Users and profile
  user_not_found: { status: 404, message: "User not found" },
  email_taken: { status: 409, message: "A user with that email already exists" },
  current_password_required: { status: 400, message: "Enter your current password" },
  wrong_current_password: { status: 401, message: "Current password is wrong" },
  cannot_demote_self: { status: 400, message: "You cannot remove your own admin role" },
  cannot_delete_self: { status: 400, message: "You cannot delete your own account" },
  last_admin_demote: { status: 400, message: "Cannot demote the last admin" },
  last_admin_delete: { status: 400, message: "Cannot delete the last admin" },
  owner_stays_admin: { status: 400, message: "The instance owner stays an admin" },
  owner_not_deletable: { status: 400, message: "The instance owner can't be deleted" },
  avatar_not_found: { status: 404, message: "No avatar" },
  avatar_not_square: { status: 400, message: "The avatar must be square" },
  avatar_too_large: {
    status: 413,
    message: (p: { maxMb: number }) => `Avatar images can be at most ${p.maxMb} MB`,
  },

  // Two-factor authentication
  two_factor_setup_required: {
    status: 403,
    message: "Set up two-factor authentication to continue",
  },
  two_factor_own_first: {
    status: 400,
    message:
      "Nice try! Set up two-factor authentication for yourself first, then you can make everyone else do it.",
  },
  two_factor_still_required: {
    status: 400,
    message: "Two-factor authentication is required here, so it can't be turned off",
  },
  two_factor_reset_own: {
    status: 400,
    message: "Manage your own two-factor authentication in your profile",
  },

  // Sammelbände (tenants)
  sammelband_not_found: { status: 404, message: "Sammelband not found" },
  multi_tenant_disabled: { status: 404, message: "Multiple Sammelbände are not enabled" },
  name_required: { status: 400, message: "Name required" },
  unknown_timezone: { status: 400, message: "Unknown time zone" },
  cannot_suspend_own_sammelband: { status: 400, message: "You cannot suspend your own Sammelband" },
  cannot_delete_own_sammelband: { status: 400, message: "You cannot delete your own Sammelband" },
  confirm_name_mismatch: { status: 400, message: "Type the Sammelband's name to confirm" },
  quota_exceeded: {
    status: 413,
    message: "Storage quota exceeded. Ask your admin for more space.",
  },

  // Folders and albums
  folder_not_found: { status: 404, message: "Folder not found" },
  parent_folder_not_found: { status: 404, message: "Parent folder not found" },
  folder_own_parent: { status: 400, message: "A folder cannot be its own parent" },
  folder_into_descendant: {
    status: 400,
    message: "Cannot move a folder into one of its own sub-folders",
  },
  folder_has_albums: {
    status: 409,
    message: "Folder is not empty — move or delete its albums first",
  },
  folder_has_subfolders: {
    status: 409,
    message: "Folder is not empty — move or delete its sub-folders first",
  },
  album_not_found: { status: 404, message: "Album not found" },
  title_required: { status: 400, message: "Title required" },
  target_not_found: { status: 404, message: "The drop target is no longer here" },

  // Sections
  section_not_found: { status: 404, message: "Section not found" },
  anchor_section_not_found: {
    status: 404,
    message: "The neighbouring section no longer exists",
  },

  // Photos and images
  photo_not_found: { status: 404, message: "Photo not found" },
  photo_not_in_album: { status: 404, message: "Photo not found in this album" },
  target_photo_not_found: { status: 404, message: "The neighbouring photo no longer exists" },
  image_not_found: { status: 404, message: "Image not found" },
  unsupported_width: { status: 400, message: "Unsupported image width" },
  only_images: { status: 400, message: "Only images are allowed" },
  no_files: { status: 400, message: "Choose at least one image" },
  unreadable_image: { status: 400, message: "Unable to read the image" },
  file_too_large: {
    status: 413,
    message: (p: { maxMb: number }) => `Photos can be at most ${p.maxMb} MB`,
  },
  image_too_large: {
    status: 413,
    message: (p: { maxMegapixels: number }) =>
      `Photos can have at most ${p.maxMegapixels} megapixels`,
  },

  // Share links
  share_link_not_found: { status: 404, message: "Share link not found" },
  share_target_required: { status: 400, message: "Pass either albumId or folderId" },
  share_password_too_short: {
    status: 400,
    message: (p: { min: number }) => `Passwords need at least ${p.min} characters`,
  },
  expiry_in_past: { status: 400, message: "The expiry date must be in the future" },
  share_invalid: { status: 404, message: "This link is invalid or has expired" },
  share_locked: { status: 401, message: "This link is password protected" },
  wrong_password: { status: 401, message: "Wrong password" },
  not_in_share: { status: 404, message: "Not part of this link" },
} satisfies Record<string, Entry>;

export type ErrorCode = keyof typeof ERRORS;

/** The params a code's message takes, or never when it takes none. */
export type ErrorParams<C extends ErrorCode> = (typeof ERRORS)[C]["message"] extends (
  p: infer P,
) => string
  ? P
  : never;

export function errorMessage(code: ErrorCode, params?: Params): string {
  const { message } = ERRORS[code] as Entry;
  return typeof message === "function" ? (message as (p: Params) => string)(params ?? {}) : message;
}

/** JSON body for an error response. */
export function errorBody(code: ErrorCode, params?: Params) {
  return { error: errorMessage(code, params), code, ...(params && { params }) };
}
