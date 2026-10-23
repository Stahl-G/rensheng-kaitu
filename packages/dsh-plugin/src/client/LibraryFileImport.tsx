import type { FileImportSource } from "@kaitu/core";
import { useEffect, useState } from "react";
import { type FileImportServices, OnboardingFileImport } from "./OnboardingSources.js";
import styles from "./OnboardingSources.module.css";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

/** A dropped File and a picked File take the same preview/confirmation path. */
export function LibraryFileImport(
  props: FileImportServices & {
    initialFile?: File;
    capture: (text: string) => Promise<unknown>;
    onDone: () => Promise<void>;
    onClose: () => void;
  },
) {
  const t = useT();
  const [file, setFile] = useState(props.initialFile);
  const [kind, setKind] = useState<FileImportSource | "text" | "choose">();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setFile(props.initialFile), [props.initialFile]);
  useEffect(() => {
    let active = true;
    setKind(undefined);
    setError("");
    setSaved(false);
    if (!file) {
      setBusy(false);
      return;
    }
    setBusy(true);
    void (async () => {
      const extension = file.name.split(".").at(-1)?.toLowerCase();
      if (
        ["txt", "md", "markdown"].includes(extension ?? "") ||
        (!file.name.includes(".") && file.type === "text/plain")
      ) {
        if (file.size > 400000)
          throw new Error(
            t(
              "原文最多 10 万字，请拆成较小的文件。",
              "Originals support up to 100,000 characters. Split this file into smaller parts.",
            ),
          );
        const content = await file.text();
        if (!content.trim() || content.length > 100000 || content.includes("\0"))
          throw new Error(
            t(
              "请选择非空的文本或 Markdown 文件，最多 10 万字。",
              "Choose a nonempty text or Markdown file, up to 100,000 characters.",
            ),
          );
        if (active) {
          setText(content);
          setKind("text");
        }
      } else {
        let source: FileImportSource | "choose";
        if (extension === "ics") source = "ics";
        else if (extension === "xml") source = "apple-health";
        else if (extension === "zip") source = "choose";
        else if (extension === "json") {
          const content = JSON.parse(await file.text());
          source = content?.format === "nutai.backup" ? "nut-ai" : "chatgpt-conversations";
        } else
          throw new Error(
            t(
              "支持文本、Markdown、聊天 JSON / ZIP、日历 ICS 和 Nut AI 备份。",
              "Use text, Markdown, chat JSON / ZIP, calendar ICS or a Nut AI backup.",
            ),
          );
        if (active) setKind(source);
      }
    })()
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [file, t]);
  if (file && kind && kind !== "text")
    return (
      <OnboardingFileImport
        {...props}
        key={kind}
        initialFile={file}
        source={kind === "choose" ? undefined : kind}
        defaultSource="chatgpt-conversations"
      />
    );
  return (
    <section className={`${css.card} ${css["sub-form"]}`} aria-label={t("导入文件", "Import a file")}>
      <strong>{file?.name ?? t("导入文件", "Import a file")}</strong>
      {!file && (
        <label>
          {t("选择资料文件", "Choose a file")}
          <input
            type="file"
            accept=".txt,.md,.markdown,.json,.zip,.ics,.xml"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
        </label>
      )}
      {kind === "text" && (
        <label>
          {t("原文预览", "Original preview")}
          <textarea
            className={styles.textarea}
            value={text}
            maxLength={100000}
            rows={10}
            disabled={busy || saved}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      )}
      {busy && <output>{t("正在处理…", "Processing…")}</output>}
      {error && <p role="alert">{error}</p>}
      <div className={css["dialog-foot"]}>
        <button type="button" className={css.link} disabled={busy} onClick={props.onClose}>
          {t("取消", "Cancel")}
        </button>
        {kind === "text" && (
          <button
            type="button"
            className={`${css.btn} ${css["btn-primary"]}`}
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                if (!saved) {
                  await props.capture(text);
                  setSaved(true);
                }
                await props.onDone();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {saved ? t("重新读取结果", "Reload result") : t("保存原文", "Save original")}
          </button>
        )}
      </div>
    </section>
  );
}
