// Shared pure OpenMAIC rendering contract; subpath keeps Node workspace APIs out of browser bundles.
import { byteLength, openmaicMetaFrom, validateFragment } from "./learning-openmaic/fragment.js";
import { buildFrameDoc, buildWidgetDoc } from "./learning-openmaic/shell.js";
import { widgetMetaFrom } from "./learning-openmaic/widget-meta.js";
export * from "./learning-openmaic/fragment.js";
export * from "./learning-openmaic/widget-meta.js";
export * from "./learning-openmaic/shell.js";

export function renderTeachingFrame(meta: unknown, callId: string): string | undefined {
  const card = openmaicMetaFrom(meta);
  if (card) {
    validateFragment(card.fragment, 256 * 1024);
    return buildFrameDoc({
      fragment: card.fragment,
      title: card.title,
      themeVars: {},
      colorScheme: "light",
      reportToken: callId,
    });
  }
  const widget = widgetMetaFrom(meta);
  if (widget && byteLength(widget.html) <= 256 * 1024) return buildWidgetDoc(widget.html, callId);
  return undefined;
}
