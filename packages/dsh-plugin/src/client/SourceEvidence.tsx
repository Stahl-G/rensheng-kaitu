import { useEffect, useRef, useState } from "react";
import type { ExperienceSource } from "../types.js";
import css from "./MapPage.module.css";

export function SourceEvidence({
  id,
  load,
}: { id: string; load: (id: string) => Promise<ExperienceSource> }) {
  const focus = useRef<HTMLElement>(null);
  const [source, setSource] = useState<ExperienceSource | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        {busy ? "正在读取原文…" : open ? "收起原文" : "查看原文"}
      </button>
      {open && (
        <div aria-label="经历来源原文">
          {error && <p role="alert">{error}</p>}
          {source?.kind === "local" && (
            <>
              <p className={css.source}>
                {source.file} · 从第 {source.firstLine} 行显示
                {source.focusLine ? ` · 定位第 ${source.focusLine} 行` : ""}
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
              {source.truncated && <p className={css.secondary}>显示原文片段，完整资料保留在工作区。</p>}
            </>
          )}
          {source?.kind === "external" && (
            <a href={source.url} target="_blank" rel="noreferrer">
              打开来源网页 ↗
            </a>
          )}
          {source?.kind === "unavailable" && <p className={css.secondary}>{source.reason}</p>}
        </div>
      )}
    </div>
  );
}
