/**
 * Pure shared contract for the `openmaic_widget` tool: the supported widget
 * types and the `tool/result` meta descriptor. No I/O, no DOM, and no value
 * import of a host package, so the node half, the browser half, and vitest all
 * load it unchanged — same rule as `./fragment.ts`.
 *
 * The browser bundle must import the meta narrowing from here, never from
 * `./widget.ts`: that module value-imports `@deepseek-ai/dsh-llm`,
 * `@deepseek-ai/dsh-tools` and `@openmaic/generation`, which tsdown keeps
 * external, so the client bundle would emit `require()` calls the web shell's
 * frozen module table cannot answer and the plugin would fail to load.
 *
 * @module @openmaic/dsh-openmaic/widget-meta
 */

// Type-only: keeps SUPPORTED_WIDGET_TYPES pinned to the SDK's union without
// linking the SDK into the browser bundle.

/** Wire name of the tool and of the keyed toolview. */

/** The widget types v0.3 wires up first. */
export const SUPPORTED_WIDGET_TYPES = ["simulation", "game", "code"] as const;

export type SupportedWidgetType = (typeof SUPPORTED_WIDGET_TYPES)[number];

/** The `tool/result` meta descriptor persisted for replay-stable rendering. */
export interface WidgetMeta {
  kind: "openmaic-widget";
  /** The generated widget document, inlined so replay never re-generates. */
  html: string;
  /** Concise human title shown in the card header. */
  title: string;
  widgetType: SupportedWidgetType;
}

/**
 * Narrow an opaque `tool/result` meta into a well-formed {@link WidgetMeta}.
 * @param meta - the persisted meta value.
 * @returns the narrowed descriptor, or `undefined` on any mismatch.
 */
export function widgetMetaFrom(meta: unknown): WidgetMeta | undefined {
  if (typeof meta !== "object" || meta === null) return undefined;
  const m = meta as { kind?: unknown; html?: unknown; title?: unknown; widgetType?: unknown };
  if (m.kind !== "openmaic-widget") return undefined;
  if (typeof m.html !== "string" || typeof m.title !== "string") return undefined;
  if (m.widgetType !== "simulation" && m.widgetType !== "game" && m.widgetType !== "code") return undefined;
  return { kind: "openmaic-widget", html: m.html, title: m.title, widgetType: m.widgetType };
}
