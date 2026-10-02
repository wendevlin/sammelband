import type { SourceId, SourceListing } from "@sammelband/shared";

/** A downloaded original (or the largest rendition a source offers). */
export type SourceFile = { bytes: Uint8Array<ArrayBuffer>; name: string; type: string };

/**
 * A place photos can be imported from besides uploads. Admins switch it on per
 * Sammelband, with a default `Config` (e.g. the server address); users connect
 * accounts, each with its own `Config` and `Credentials` (stored encrypted).
 * Imported photos become ordinary uploads: sources are only read while
 * picking and importing.
 *
 * Locations and refs are the source's own opaque strings (a path for
 * Nextcloud, album and asset ids for Immich); the web app only passes them back.
 */
export interface PhotoSource<Config = unknown, Credentials = unknown> {
  id: SourceId;
  name: string;
  /** Validate and normalize a config (the default or an account's); may contact the server. */
  parseConfig(input: Record<string, unknown>): Promise<Config>;
  /** What admins see in the settings form. */
  showConfig(config: Config): Record<string, string>;
  /** Which server a config points to, shown with the account. */
  serverOf(config: Config): string;
  /** A folder (`location`, or the top when null). */
  browse(config: Config, credentials: Credentials, location: string | null): Promise<SourceListing>;
  /** A small preview image for the picker. */
  thumbnail(
    config: Config,
    credentials: Credentials,
    thumb: string,
    size: number,
  ): Promise<SourceFile>;
  /** The photo to import. */
  download(config: Config, credentials: Credentials, ref: string): Promise<SourceFile>;
  /** Best effort: revoke the credentials at the source when an account is removed. */
  revoke?(config: Config, credentials: Credentials): Promise<void>;
}
