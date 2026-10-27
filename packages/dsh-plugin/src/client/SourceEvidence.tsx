import { useEffect, useMemo, useRef, useState } from "react";
import type { ExperienceSource } from "../types.js";
import css from "./MapPage.module.css";
import { useT } from "./i18n.js";

export function SourceEvidence({
  id,
  load,
  label,
}: { id: string; label?: string; load: (id: string) => Promise<ExperienceSource> }) {
  const t = useT();
  const focus = useRef<HTMLElement>(null);
  const [source, setSource] = useState<ExperienceSource | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachment = useMemo(() => {
    if (source?.kind !== "attachment") return null;
    const bytes = Uint8Array.from(atob(source.data), (value) => value.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: source.mime }));
  }, [source]);
  useEffect(
    () => () => {
      if (attachment) URL.revokeObjectURL(attachment);
    },
    [attachment],
  );
  useEffect(() => {
    if (source?.kind === "local" && source.focusLine) focus.current?.scrollIntoView({ block: "nearest" });
  }, [source]);
  const lines = source?.kind === "local" && source.focusLine ? source.text.split("\n") : null;
  const lineIndex = source?.kind === "local" && source.focusLine ? source.focusLine - source.firstLine : 0;
  return (
    <div className={css.evidence}>
      <button
        type="button"
        className={css.link}
        disabled={busy}
        aria-expanded={open}
        onClick={async () => {
          if (open) {
            setOpen(false);
            return;
          }
          setOpen(true);
          setBusy(true);
          setError(null);
          setSource(null);
          try {
            setSource(await load(id));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? t("正在读取原文…", "Loading source…")
          : open
            ? t("收起原文", "Hide source")
            : (label ?? t("查看原文", "View source"))}
      </button>
      {open && (
        <div aria-label={t("来源原文", "Source text")}>
          {error && <p role="alert">{error}</p>}
          {source?.kind === "attachment" && attachment && (
            <>
              <p className={css.source}>
                {source.name} · {t(`第 ${source.page} 页`, `Page ${source.page}`)}
              </p>
              {source.mime.startsWith("image/") && (
                <img
                  src={`data:${source.mime};base64,${source.data}`}
                  alt={t("导入的本人经历截图", "Imported personal career screenshot")}
                  style={{ maxWidth: "100%", maxHeight: 600, objectFit: "contain" }}
                />
              )}
              <a href={`${attachment}#page=${source.page}`} target="_blank" rel="noreferrer">
                {t("打开原件 ↗", "Open original ↗")}
              </a>
              {" · "}
              <a href={attachment} download={source.name}>
                {t("下载原件", "Download original")}
              </a>
            </>
          )}
          {source?.kind === "local" && (
            <>
              <p className={css.source}>
                {source.file} · {t(`从第 ${source.firstLine} 行显示`, `From line ${source.firstLine}`)}
                {source.focusLine
                  ? t(` · 定位第 ${source.focusLine} 行`, ` · Highlighting line ${source.focusLine}`)
                  : ""}
              </p>
              <pre className={css.sourceText}>
                {lines ? (
                  <>
                    {lines.slice(0, lineIndex).join("\n")}
                    {lineIndex > 0 ? "\n" : ""}
                    <mark ref={focus}>{lines[lineIndex]}</mark>
                    {"\n"}
                    {lines.slice(lineIndex + 1).join("\n")}
                  </>
                ) : (
                  source.text
                )}
              </pre>
              {source.truncated && (
                <p className={css.secondary}>
                  {t(
                    "显示原文片段，完整资料保留在工作区。",
                    "Showing an excerpt. The full source stays in your workspace.",
                  )}
                </p>
              )}
            </>
          )}
          {source?.kind === "external" && (
            <a href={source.url} target="_blank" rel="noreferrer">
              {t("打开来源网页 ↗", "Open source page ↗")}
            </a>
          )}
          {source?.kind === "unavailable" && (
            <p className={css.secondary}>
              {t(
                source.reason,
                (
                  {
                    "来源链接不完整，请核对来源": "The source link is incomplete. Review its location.",
                    这条经历尚未附可打开的原文路径: "This place has no source location to open yet.",
                    "原文已移动或不在当前工作区，经历仍保留":
                      "The source moved or is outside this workspace. The place is kept.",
                  } as Record<string, string>
                )[source.reason] ??
                  (/^当前原文没有第 \d+ 行，请核对来源定位$/.test(source.reason)
                    ? "This line is missing from the source. Review its location."
                    : source.reason),
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
