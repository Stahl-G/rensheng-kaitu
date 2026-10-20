/**
 * Pure shared contract for the `openmaic_render` tool: fragment validation and
 * the `tool/result` meta descriptor. No I/O and no DOM, so the node half, the
 * browser half, and vitest all load it unchanged.
 *
 * A fragment is the model-authored inline-HTML body of one teaching card:
 * literal markup without a document skeleton. The card owns the skeleton (it
 * wraps the fragment in a sandboxed iframe document with its own CSP), so a
 * fragment that ships its own `<!doctype>`/`<html>`/`<head>`/`<body>` would
 * nest documents and is rejected loudly instead of rendered broken.
 *
 * @module @openmaic/dsh-openmaic/fragment
 */

/** Wire name of the tool, the keyed toolview, and the streaming-preview match. */
export const OPENMAIC_RENDER_TOOL_NAME = "openmaic_render";

/** The `tool/result` meta descriptor persisted for replay-stable rendering. */
export interface OpenmaicMeta {
  /** Discriminant for consumers sharing the meta channel. */
  kind: "openmaic-render";
  /** The validated fragment body, inlined so replay never re-reads a file. */
  fragment: string;
  /** Concise human title shown in the card header. */
  title: string;
}

/** Document-skeleton tags a fragment must not contain (case-insensitive). */
const SKELETON_TAG = /<!doctype\b|<\s*(?:html|head|body)\b/iu;

/** UTF-8 byte length of a string. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Validate one fragment against the inline contract.
 * @param fragment - the markup the model wrote.
 * @param maxBytes - deployment size ceiling for one fragment.
 * @returns the fragment's UTF-8 size in bytes.
 * @throws Error naming the violated rule; the tool surfaces it as `isError`.
 */
export function validateFragment(fragment: string, maxBytes: number): number {
  if (fragment.trim().length === 0) {
    throw new Error("invalid openmaic fragment: the fragment is empty");
  }
  const sizeBytes = byteLength(fragment);
  if (sizeBytes > maxBytes) {
    throw new Error(
      `invalid openmaic fragment: fragment is ${sizeBytes} bytes, over the ${maxBytes}-byte limit; shrink the inline data first`,
    );
  }
  const skeleton = SKELETON_TAG.exec(fragment);
  if (skeleton) {
    throw new Error(
      `invalid openmaic fragment: fragment contains a document-skeleton tag (${JSON.stringify(skeleton[0])}); write only the inline body`,
    );
  }
  return sizeBytes;
}

/**
 * Narrow an opaque `tool/result` meta into a well-formed {@link OpenmaicMeta}.
 * @param meta - the persisted meta value.
 * @returns the narrowed descriptor, or `undefined` on any mismatch.
 */
export function openmaicMetaFrom(meta: unknown): OpenmaicMeta | undefined {
  if (typeof meta !== "object" || meta === null) return undefined;
  const m = meta as { kind?: unknown; fragment?: unknown; title?: unknown };
  if (m.kind !== "openmaic-render") return undefined;
  if (typeof m.fragment !== "string" || typeof m.title !== "string") return undefined;
  return { kind: "openmaic-render", fragment: m.fragment, title: m.title };
}
