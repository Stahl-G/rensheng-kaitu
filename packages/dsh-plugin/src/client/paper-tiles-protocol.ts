import { addProtocol } from "maplibre-gl";

let registered = false;
/** Packaged bytes are available offline in both DSH and standalone hosts.
 * MapLibre asks only for visible tiles; JPEG decoding/upload stays viewport-limited.
 */
export function registerPaperTiles() {
  if (registered) return;
  registered = true;
  addProtocol("kaitu-paper", async ({ url }, abortController) => {
    const target = new URL(url);
    const key = `${target.hostname}${target.pathname}`;
    const tiles = (await import("./map-assets/paper-tiles.json")).default as Record<string, string>;
    if (abortController.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const encoded = tiles[key];
    if (!encoded) throw new Error("Local paper tile unavailable");
    const data = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    return { data: data.buffer };
  });
}
