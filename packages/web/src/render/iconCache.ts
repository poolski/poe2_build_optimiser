// packages/web/src/render/iconCache.ts
//
// Async image cache for node icons (intake/web-ui/10-repoe-asset-source.md phase 3). Icons are
// served from Vite's public/ dir (packages/web/public/icons/tree/<path>.png, fetched by
// scripts/fetch-icons.mjs) -- never blocks the draw loop: getIcon() returns null immediately for
// anything not yet loaded, and draw.ts falls back to the stylised dot.

const BASE = "/icons/tree/";

type Listener = () => void;

const cache = new Map<string, HTMLImageElement | "error">();
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to icon load/error events -- used to mark a canvas dirty for a redraw once a
 *  previously-missing icon becomes available. Returns an unsubscribe function. */
export function onIconLoad(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Returns the loaded image for `path`, or null if it's empty, still loading, or errored.
 *  Kicks off a load on the first request for a given path; never throws, never blocks. */
export function getIcon(path: string): HTMLImageElement | null {
  if (!path) return null;
  const entry = cache.get(path);
  if (entry === "error") return null;
  if (entry) return entry.complete ? entry : null;

  const img = new Image();
  cache.set(path, img);
  img.onload = () => notify();
  img.onerror = () => {
    cache.set(path, "error");
    notify();
  };
  img.src = `${BASE}${path.replace(/\.dds$/i, ".png")}`;
  return null;
}

/** Test-only: reset module-level state between tests. */
export function __resetIconCache(): void {
  cache.clear();
  listeners.clear();
}
