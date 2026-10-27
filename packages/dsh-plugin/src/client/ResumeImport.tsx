import type { ResumeReceipt, ResumeUpload } from "@kaitu/core";
import { useEffect, useState } from "react";
import { ResumeImageCrop } from "./ResumeImageCrop.js";
import css from "./WorkPage.module.css";
import { useT } from "./i18n.js";

export interface ResumeServices {
  uploadResume: (name: string, base64: string) => Promise<ResumeUpload>;
  resumePrompt: (file: string) => Promise<string>;
  extractResume?: (file: string) => Promise<{ answer: string; provider: string; model: string }>;
  importResume: (file: string, answer: string) => Promise<ResumeReceipt>;
  resumeConnection: () => Promise<{
    configured: boolean;
    provider: string;
    model: string;
    supportsImages: boolean;
  }>;
}
const encode = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let value = "";
  for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
};

export function ResumeImport(props: ResumeServices & { onChanged: () => Promise<void> }) {
  const t = useT();
  const [connection, setConnection] = useState<Awaited<ReturnType<ResumeServices["resumeConnection"]>>>();
  const [upload, setUpload] = useState<ResumeUpload>();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ResumeReceipt>();
  const [prompt, setPrompt] = useState("");
  const [external, setExternal] = useState(false);
  const [cropFile, setCropFile] = useState<File>();
  useEffect(() => {
    let active = true;
    void props
      .resumeConnection()
      .then((result) => {
        if (active) setConnection(result);
      })
      .catch((err) => {
        if (active) setError(String(err));
      });
    return () => {
      active = false;
    };
  }, [props.resumeConnection]);
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };
  const commit = async (value: string) => {
    if (!upload) return;
    const result = await props.importResume(upload.file, value);
    setReceipt(result);
    await props.onChanged();
  };
  return (
    <section className={css.card} aria-label={t("导入简历", "Import résumé")} aria-busy={!!busy}>
      <h2>{t("导入简历", "Import résumé")}</h2>
      <p>
        {t(
          "选择自己的 PDF 简历或主页截图。截图请先裁剪到本人的工作与教育，去掉侧栏、消息和其他人资料。",
          "Choose your PDF résumé or profile screenshot. Crop screenshots to your work and education, excluding sidebars, messages and other people.",
        )}
      </p>
      <p className={css.meta}>
        {connection?.configured
          ? t(
              `由问问当前连接处理：${connection.provider} · ${connection.model}。PDF 只发送文字；截图发送图片。`,
              `Processed by your Ask connection: ${connection.provider} · ${connection.model}. PDFs send text; screenshots send images.`,
            )
          : t(
              "没有连接 AI 也能保留原件，复制提示词给常用 AI，再贴回结果。",
              "Without connected AI, keep the original, copy the prompt to your usual AI, then paste the result.",
            )}
      </p>
      <label className={css.fileInput}>
        {t("PDF / 截图 · 最大 20MB", "PDF / screenshot · up to 20MB")}
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          disabled={!!busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            setExternal(false);
            setUpload(undefined);
            setReceipt(undefined);
            setPrompt("");
            setAnswer("");
            if (!file) return;
            void run(t("正在读取文件…", "Reading file…"), async () => {
              if (!file.size || file.size > 20 * 1024 * 1024)
                throw new Error(t("请选择 20MB 以内的非空文件", "Choose a nonempty file up to 20MB"));
              if (!/\.pdf$/i.test(file.name)) {
                setCropFile(file);
                return;
              }
              setUpload(await props.uploadResume(file.name, await encode(file)));
            });
          }}
        />
      </label>
      {cropFile && (
        <ResumeImageCrop
          file={cropFile}
          cancel={() => setCropFile(undefined)}
          save={async (base64) => {
            setUpload(await props.uploadResume(`${cropFile.name.replace(/\.[^.]+$/, "")}.png`, base64));
          }}
        />
      )}
      {upload && (
        <p className={css.meta}>
          {upload.name} ·{" "}
          {upload.pages.length
            ? t(`${upload.pages.length} 页文字已读取`, `${upload.pages.length} text pages read`)
            : t("单张截图", "One screenshot")}
        </p>
      )}
      {upload && !receipt && (
        <>
          {connection?.configured && props.extractResume && (
            <button
              className={css.primary}
              type="button"
              disabled={!!busy || (upload.mime !== "application/pdf" && !connection.supportsImages)}
              onClick={() =>
                void run(t("正在抽取并记录经历…", "Extracting and recording experience…"), async () => {
                  const result = await props.extractResume?.(upload.file);
                  if (result) await commit(result.answer);
                })
              }
            >
              {t("读取并自动记录", "Read and record automatically")}
            </button>
          )}
          {connection?.configured && upload.mime !== "application/pdf" && !connection.supportsImages && (
            <p>
              {t(
                "当前模型不能看图，请换模型或使用下方外部 AI。",
                "This model cannot read images. Switch models or use an external AI below.",
              )}
            </p>
          )}
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              void run(t("正在准备提示词…", "Preparing prompt…"), async () => {
                const value = await props.resumePrompt(upload.file);
                setPrompt(value);
                setExternal(true);
                await navigator.clipboard.writeText(value).catch(() => {});
              })
            }
          >
            {t("用常用 AI 整理 →", "Use my usual AI →")}
          </button>
          {external && (
            <>
              <p className={css.meta}>
                {t(
                  "复制提示词；截图同时由你附给 AI。把 JSON 回答贴回即记录，不需逐条批准。",
                  "Copy the prompt; attach the screenshot yourself if needed. Paste the JSON response to record it without approving each fact.",
                )}
              </p>
              {prompt && (
                <details>
                  <summary>{t("查看并复制提示词", "View and copy prompt")}</summary>
                  <textarea
                    readOnly
                    rows={8}
                    value={prompt}
                    aria-label={t("简历整理提示词", "Résumé prompt")}
                  />
                </details>
              )}
              <label>
                {t("贴回 AI 的 JSON 回答", "Paste the AI JSON response")}
                <textarea
                  value={answer}
                  rows={6}
                  disabled={!!busy}
                  onChange={(event) => setAnswer(event.target.value)}
                />
              </label>
              <button
                className={css.primary}
                type="button"
                disabled={!!busy || !answer.trim()}
                onClick={() => void run(t("正在记录经历…", "Recording experience…"), () => commit(answer))}
              >
                {t("记录这次导入", "Record this import")}
              </button>
            </>
          )}
        </>
      )}
      {busy && <output>{busy}</output>}
      {error && <p role="alert">{error}</p>}
      {receipt && (
        <output>
          {t(
            `已新增 ${receipt.added} 条，跳过重复 ${receipt.duplicates} 条，待核对 ${receipt.pending} 条，排除 ${receipt.excluded} 条。整批撤销在下方「来源与导入」。`,
            `Added ${receipt.added}, skipped ${receipt.duplicates} duplicates, ${receipt.pending} to review, ${receipt.excluded} excluded. Undo the batch under Sources and imports below.`,
          )}
        </output>
      )}
    </section>
  );
}
