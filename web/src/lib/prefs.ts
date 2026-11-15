// Small per-device preferences kept in localStorage. Every access is wrapped in try/catch:
// storage can throw in private windows or when blocked.

export type GiftsView = "cards" | "table";
const VIEW_KEY = "gl.giftsView";

export function readGiftsView(): GiftsView {
  try {
    return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

export function storeGiftsView(v: GiftsView): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* ignore */
  }
}
