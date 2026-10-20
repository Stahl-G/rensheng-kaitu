/**
 * Pure assembly of the sandboxed frame document a teaching card renders in.
 * DOM-free so the node-side specs exercise it directly; the browser card is
 * its only production caller.
 *
 * Security model: the card mounts `<iframe sandbox="allow-scripts">`, an
 * opaque origin with no access to the host page, and this document's own CSP
 * meta tag confines what runs inside: inline script/style plus a fixed CDN
 * allowlist, no fetch/XHR/WebSocket (`connect-src` covers only blob/data), no
 * nested frames, no form posts.
 *
 * @module @openmaic/dsh-openmaic/shell
 */

import { FRAME_CSS } from "./frame-css.js";

/** CDN origins a fragment may load static resources from. */
export const RESOURCE_ORIGINS = [
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
  "https://esm.sh",
  "https://fonts.bunny.net",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://unpkg.com",
] as const;

const RESOURCE_SOURCES = ["blob:", "data:", ...RESOURCE_ORIGINS].join(" ");

/** The frame document's Content-Security-Policy. */
export const FRAME_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${RESOURCE_SOURCES}`,
  `style-src 'unsafe-inline' ${RESOURCE_SOURCES}`,
  `img-src ${RESOURCE_SOURCES}`,
  `font-src ${RESOURCE_SOURCES}`,
  `media-src ${RESOURCE_SOURCES}`,
  "worker-src blob:",
  "connect-src blob: data:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Wire type of the frame→card height report message. */
export const HEIGHT_MESSAGE_TYPE = "dsh-openmaic:height";

/** Inputs to one frame document assembly. */
export interface FrameDocOptions {
  /** The validated fragment body. */
  fragment: string;
  /** Document title (escaped here). */
  title: string;
  /** Host palette bridged into the frame as `--dsh-openmaic-*` custom properties. */
  themeVars: Record<string, string>;
  /** Host `color-scheme` so `light-dark()` in the frame follows the host theme. */
  colorScheme: "light" | "dark";
  /** Correlation token echoed in every height report (the tool callId in production). */
  reportToken: string;
}

/**
 * Assemble the complete srcdoc document for one teaching card frame.
 * @param options - fragment, title, bridged palette, and report token.
 * @returns the HTML document string for the iframe's `srcDoc`.
 */
export function buildFrameDoc(options: FrameDocOptions): string {
  const rootVars = Object.entries(options.themeVars)
    .map(([name, value]) => [name, sanitizeCssValue(value)] as const)
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => `--dsh-openmaic-${name}: ${value};`)
    .join(" ");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">
<title>${escapeHtml(options.title)}</title>
<style>${FRAME_CSS}
:root { ${rootVars} color-scheme: ${options.colorScheme}; }
body { padding: 4px 2px; }</style>
</head>
<body>
${options.fragment}
<script>${heightReporter(options.reportToken)}</script>
</body>
</html>
`;
}

/**
 * The frame-side height reporter: posts the document's scroll height to the
 * parent on load and on every resize, so the card can size the iframe to its
 * content (a sandboxed frame's document is unreachable from the parent).
 * @param reportToken - correlation token echoed in each message.
 * @returns the inline script body.
 */
function heightReporter(reportToken: string): string {
  const token = JSON.stringify(reportToken);
  return `
(function () {
  var post = function () {
    parent.postMessage({
      type: ${JSON.stringify(HEIGHT_MESSAGE_TYPE)},
      token: ${token},
      height: document.documentElement.scrollHeight,
    }, '*');
  };
  new ResizeObserver(post).observe(document.documentElement);
  addEventListener('load', post);
  post();
})();
`;
}

/**
 * Mount a complete widget document for the sandboxed frame: inject the height
 * reporter before `</body>` (or append at the end when the model omitted it)
 * so the card can size the iframe to the widget's full document height.
 * @param html - the complete HTML document produced by @openmaic/generation.
 * @param reportToken - correlation token echoed in each height report.
 * @returns the document string for the iframe's `srcDoc`.
 */
export function buildWidgetDoc(html: string, reportToken: string): string {
  // Apply the same no-fetch/no-form boundary as fragments, before authored scripts.
  const policy = `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`;
  const protectedHtml = /<head(?:\s[^>]*)?>/iu.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/iu, (head) => `${head}${policy}`)
    : `${policy}${html}`;
  const script = `<script>${heightReporter(reportToken)}</script>`;
  const closeBody = /<\/body\s*>/iu;
  if (closeBody.test(protectedHtml)) return protectedHtml.replace(closeBody, `${script}</body>`);
  return `${protectedHtml}${script}`;
}

/**
 * Keep one bridged palette value inert inside a style block: resolved
 * computed-style colors never contain declaration or block delimiters, so any
 * occurrence marks a malformed value, dropped rather than repaired.
 * @param value - the raw computed-style value.
 * @returns the trimmed value, or empty when it must be dropped.
 */
export function sanitizeCssValue(value: string): string {
  const trimmed = value.trim();
  return /[;{}<>]/u.test(trimmed) ? "" : trimmed;
}

/**
 * Minimal HTML text escape for the frame `<title>`.
 * @param text - raw text.
 * @returns the escaped text.
 */
function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
