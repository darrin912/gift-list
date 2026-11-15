// Theme preference: System / Light / Dark / Holiday. Stored in localStorage and applied as
// a data-theme attribute on <html>. index.html has an inline copy of `attributeFor` so the
// theme is set before first paint (no flash); keep the two in sync.

export type ThemePref = "system" | "light" | "dark" | "holiday";
export type ResolvedTheme = "light" | "dark" | "holiday";

export const THEME_KEY = "gl.theme";
export const THEME_PREFS: ThemePref[] = ["system", "light", "dark", "holiday"];

export function parseThemePref(v: unknown): ThemePref {
  return typeof v === "string" && (THEME_PREFS as string[]).includes(v) ? (v as ThemePref) : "system";
}

/** The theme actually shown for a preference, given whether the OS prefers dark. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/** The data-theme attribute value for a preference; null (no attribute) follows the OS via CSS. */
export function attributeFor(pref: ThemePref): ResolvedTheme | null {
  return pref === "system" ? null : pref;
}

export function readThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function storeThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable (private mode); the choice lasts for this page only */
  }
}

/** Applies a preference to the document and updates the browser chrome color. */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  const attr = attributeFor(pref);
  if (attr) root.setAttribute("data-theme", attr);
  else root.removeAttribute("data-theme");
  const band = getComputedStyle(root).getPropertyValue("--band").trim();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    if (attr && band) m.setAttribute("content", band);
    else if (m.dataset.default) m.setAttribute("content", m.dataset.default);
  });
}
