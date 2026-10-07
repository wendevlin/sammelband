import type { Folder, FolderContents } from "@sammelband/shared";
import { load as get } from "#lib/api.ts";

export const load = async ({ params, fetch, depends, parent }) => {
  // Wait for the root layout's auth/onboarding gate before hitting the API.
  await parent();
  depends(`app:folder:${params.id}`);
  const [contents, allFolders] = await Promise.all([
    get<FolderContents>(`/folders/${params.id}`, fetch),
    get<Folder[]>("/folders", fetch),
  ]);
  return { ...contents, allFolders };
};
