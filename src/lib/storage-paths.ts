import { join } from "node:path";
import { config } from "../config";

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
