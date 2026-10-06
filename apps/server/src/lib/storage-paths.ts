import { join } from "node:path";
import { config } from "../config";
import { currentTenantId } from "./tenant-context";

// Every tenant's files live under their own directory, so a query bug can't
// serve another tenant's photos: paths are always built from the tenant in
// context, never from stored paths or input.

export function tenantDir(tenantId: string): string {
  return join(config.UPLOADS_PATH, "tenants", tenantId);
}

export function originalsDir(tenantId: string): string {
  return join(tenantDir(tenantId), "originals");
}

export function variantsDir(tenantId: string): string {
  return join(tenantDir(tenantId), "variants");
}

/** Original of an image in the current tenant. */
export function originalPath(filename: string): string {
  return join(originalsDir(currentTenantId()), filename);
}

/** Cached resized version of an image in the current tenant. */
export function variantPath(filename: string, width: number, format: string): string {
  return join(variantsDir(currentTenantId()), `${filename}_${width}.${format}`);
}

export function exportsDir(tenantId: string): string {
  return join(tenantDir(tenantId), "exports");
}

/** An album's PDF export in the current tenant. */
export function exportPath(filename: string): string {
  return join(exportsDir(currentTenantId()), filename);
}

/** A user's avatar in the current tenant. */
export function avatarPath(userId: string): string {
  return join(tenantDir(currentTenantId()), "avatars", `${userId}.webp`);
}
