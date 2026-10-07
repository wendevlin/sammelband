import { getContext, setContext } from "svelte";

/**
 * Which folder each source account's picker was in, while one album is being
 * edited: the section editor provides it, so closing the editor (or editing
 * another album) starts the picker in the account's start folder again.
 */
export type PickerMemory = {
  get(account: string): string | undefined;
  set(account: string, location: string): void;
  forget(account: string): void;
};

const KEY = Symbol("picker-memory");

export function providePickerMemory(album: () => string): void {
  let current = "";
  const folders = new Map<string, string>();
  const sync = () => {
    if (album() === current) return;
    current = album();
    folders.clear();
  };
  setContext<PickerMemory>(KEY, {
    get: (account) => {
      sync();
      return folders.get(account);
    },
    set: (account, location) => {
      sync();
      folders.set(account, location);
    },
    forget: (account) => folders.delete(account),
  });
}

/** The editor's memory; outside an editor, one that lasts as long as the caller. */
export function pickerMemory(): PickerMemory {
  const provided = getContext<PickerMemory | undefined>(KEY);
  if (provided) return provided;
  const folders = new Map<string, string>();
  return {
    get: (account) => folders.get(account),
    set: (account, location) => void folders.set(account, location),
    forget: (account) => void folders.delete(account),
  };
}
