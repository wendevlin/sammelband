import { adminRouter } from "../../middleware/auth.middleware";
import * as storageService from "../../services/storage.service";

export const adminStorageRoutes = adminRouter()
  .get("/admin/storage", () => storageService.getStorageStats())
  .post("/admin/storage/clear-cache", () => storageService.clearVariantsCache());
