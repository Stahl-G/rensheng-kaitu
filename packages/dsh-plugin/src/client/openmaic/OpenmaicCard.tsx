/**
 * The `openmaic_render` toolview: renders the persisted fragment from the
 * call's durable meta inside `<iframe sandbox="allow-scripts">` with the
 * frame's own CSP. Replay-stable by construction: everything drawn derives
 * from the logged call slice, never from a fragment file.
 *
 * Theme bridge and height sizing mirror dsh-visualize: the card resolves the
 * host `--dsw-alias-*` tokens at render time, and the frame posts its scroll
 * height back so the card sizes the iframe to its content.
 *
 * @module @openmaic/dsh-openmaic/client/OpenmaicCard
 */

import { type CSSProperties, useEffect, useMemo, useState } from "react";
export interface TeachingCardProps {
  callId: string;
  frameUrl?: string;
  block:
    | { kind: string; isError?: boolean; content: readonly { type: string; text?: string }[]; meta?: unknown }
    | { kind?: never };
}
import { type OpenmaicMeta, openmaicMetaFrom } from "@kaitu/core/teaching-frame";
import { HEIGHT_MESSAGE_TYPE, buildFrameDoc } from "@kaitu/core/teaching-frame";
import { resolveTheme } from "./theme.js";

/** Iframe height bounds; content beyond the cap scrolls inside the frame. */
const MIN_HEIGHT = 48;
const HEIGHT_CAP = 800;

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  fontSize: 12,
  opacity: 0.65,
  margin: "2px 0 6px",
  overflow: "hidden",
  whiteSpace: "nowrap",
};

const frameStyle: CSSProperties = {
  display: "block",
  width: "100%",
  border: 0,
  background: "transparent",
  colorScheme: "normal",
};

/** First text line of the durable result content, for the error row. */
function firstResultLine(content: readonly { type: string; text?: string }[]): string {
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      const newline = block.text.indexOf("\n");
      return newline === -1 ? block.text : block.text.slice(0, newline);
    }
  }
  return "openmaic render failed";
}

/** The settled, well-formed card: header line plus the sandboxed frame. */
function Frame({ meta, callId, frameUrl }: { meta: OpenmaicMeta; callId: string; frameUrl?: string }) {
  const [themeTick, setThemeTick] = useState(0);
  const [height, setHeight] = useState(MIN_HEIGHT);

  useEffect(() => {
    const bump = () => setThemeTick((tick) => tick + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", bump);
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const report = data as { type?: unknown; token?: unknown; height?: unknown };
      if (report.type !== HEIGHT_MESSAGE_TYPE || report.token !== callId) return;
      if (typeof report.height !== "number" || !Number.isFinite(report.height)) return;
      setHeight(Math.max(MIN_HEIGHT, Math.min(Math.ceil(report.height), HEIGHT_CAP)));
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [callId]);

  const doc = useMemo(() => {
    void themeTick; // Theme mutation must rebuild the isolated document.
    const { themeVars, colorScheme } = resolveTheme();
    return buildFrameDoc({
      fragment: meta.fragment,
      title: meta.title,
      themeVars,
      colorScheme,
      reportToken: callId,
    });
  }, [meta, callId, themeTick]);

  return (
    <div>
      <div style={headerStyle}>
        <span style={{ fontWeight: 500 }}>{meta.title}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>OpenMAIC</span>
      </div>
      <iframe
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={meta.title}
        src={frameUrl}
        srcDoc={frameUrl ? undefined : doc}
        style={{ ...frameStyle, height }}
      />
    </div>
  );
}

/**
 * Keyed toolview for the `openmaic_render` tool. Running calls and malformed
 * or failed results stay quiet single lines; only a well-formed persisted meta
 * mounts the frame.
 */
export function OpenmaicCard({ callId, block, frameUrl }: TeachingCardProps) {
  if (!("content" in block)) {
    return <div style={headerStyle}>OpenMAIC · rendering…</div>;
  }
  if (block.isError) {
    return <div style={headerStyle}>OpenMAIC · {firstResultLine(block.content)}</div>;
  }
  const meta = openmaicMetaFrom(block.meta);
  if (meta === undefined) {
    return <div style={headerStyle}>{firstResultLine(block.content)}</div>;
  }
  return <Frame meta={meta} callId={callId} frameUrl={frameUrl} />;
}
