import type Pencil from "@lucide/svelte/icons/pencil";

/**
 * One action on a list row (a user, a Sammelband). Pages build the list once;
 * tables show it as a "⋯" menu, phones as buttons in the expanded card.
 */
export type RowAction = {
  label: string;
  icon: typeof Pencil;
  run: () => unknown;
  /** Deleting and the like: red, and set apart from the others. */
  destructive?: boolean;
  /** Starts a new group (a separator in the menu). */
  group?: boolean;
};
