// Web Awesome color scheme controller.
//
// WA reads the scheme from a `wa-light` or `wa-dark` class on <html>.
// We persist the user's choice in localStorage; "system" tracks the OS via
// `prefers-color-scheme`.

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "sb-theme";

const mediaDark = matchMedia("(prefers-color-scheme: dark)");

function effective(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return mediaDark.matches ? "dark" : "light";
  return mode;
}

function apply(mode: ThemeMode) {
  const eff = effective(mode);
  document.documentElement.classList.toggle("wa-dark", eff === "dark");
  document.documentElement.classList.toggle("wa-light", eff === "light");
}

class ThemeStore extends EventTarget {
  private _mode: ThemeMode;

  constructor() {
    super();
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    this._mode = stored ?? "system";
    apply(this._mode);
    // Re-apply when the OS preference changes while we're on "system".
    mediaDark.addEventListener("change", () => {
      if (this._mode === "system") apply(this._mode);
    });
  }

  get mode(): ThemeMode {
    return this._mode;
  }

  set mode(next: ThemeMode) {
    this._mode = next;
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    this.dispatchEvent(new Event("change"));
  }
}

export const theme = new ThemeStore();
