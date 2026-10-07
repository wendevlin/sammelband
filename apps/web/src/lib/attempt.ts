import { toast } from "svelte-sonner";
import { errorText } from "#lib/i18n.ts";

/** Run an action and toast its failure. Returns the result, or undefined on error. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const result = await fn();
    if (success) toast.success(success);
    return result;
  } catch (e) {
    toast.error(errorText(e));
    return undefined;
  }
}
