import type {
  FileImportSource,
  OnboardingImportPreview,
  OnboardingSetupInput,
  OnboardingSetupPreview,
} from "@kaitu/core";
import { useEffect, useRef, useState } from "react";
import { FolderButton } from "./DshFiles.js";
import styles from "./OnboardingSources.module.css";
import css from "./Prototype.module.css";
import { detectFileImportSource, normalizeGithubRepo } from "./file-import-source.js";
import { useT } from "./i18n.js";
import type { OnboardingServices } from "./onboarding-services.js";

type Completion = { onDone: () => void | Promise<void>; onClose: () => void };

function usePreview<T extends { token: string }>(cancel: OnboardingServices["cancelOnboarding"]) {
  const [preview, setPreview] = useState<T | null>(null);
  const token = useRef<string | null>(null);
  const alive = useRef(true);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (token.current) void cancelRef.current(token.current).catch(() => {});
    };
  }, []);
  return {
    preview,
    alive,
    async clear() {
      if (token.current) await cancelRef.current(token.current);
      token.current = null;
      setPreview(null);
    },
    async accept(value: T) {
      if (!alive.current) {
        await cancelRef.current(value.token);
        return;
      }
      token.current = value.token;
      setPreview(value);
    },
    consumed() {
      token.current = null;
    },
  };
}

function fileBase64(file: File, failMessage: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error(failMessage));
    reader.onabort = () => reject(new Error(failMessage));
    reader.readAsDataURL(file);
  });
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const quiet = `${css.btn} ${css["btn-quiet"]}`;
const primary = `${css.btn} ${css["btn-primary"]}`;

export type FileImportServices = Pick<
  OnboardingServices,
  "previewOnboardingImport" | "confirmOnboardingImport" | "cancelOnboarding"
>;

export function OnboardingFileImport(
  props: FileImportServices &
    Completion & {
      source?: FileImportSource;
      defaultSource?: FileImportSource;
      initialFile?: File;
    },
) {
  const t = useT();
  const [source, setSource] = useState<FileImportSource>(props.source ?? props.defaultSource ?? "ics");
  const [needsSourceChoice, setNeedsSourceChoice] = useState(!!props.initialFile && !props.source);
  const sources = {
    "apple-health": { name: t("Apple 健康", "Apple Health"), accept: ".zip,.xml" },
    "chatgpt-conversations": { name: t("ChatGPT 对话", "ChatGPT conversations"), accept: ".zip,.json" },
    ics: { name: t("日历 ICS", "Calendar ICS"), accept: ".ics" },
    "nut-ai": { name: t("Nut AI 备份", "Nut AI backup"), accept: ".json" },
  } satisfies Record<FileImportSource, { name: string; accept: string }>;
  const session = usePreview<OnboardingImportPreview>(props.cancelOnboarding);
  const [file, setFile] = useState<File | null>(props.initialFile ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const preview = session.preview?.preview;
  const title =
    !props.source && !file && !needsSourceChoice
      ? t("导入文件", "Import a file")
      : t("导入 ", "Import ") + sources[source].name;

  async function prepare(targetFile = file, targetSource = source) {
    if (!targetFile) return;
    setBusy(true);
    setError("");
    try {
      await session.clear();
      // Match the existing 48 MiB base64 request limit before allocating the full upload.
      if (Math.ceil(targetFile.size / 3) * 4 > 48 * 1024 * 1024)
        throw new Error(
          t(
            "文件超过 36 MiB，请拆成较小的导出文件。",
            "This file exceeds 36 MiB. Split it into smaller exports.",
          ),
        );
      const unreadable = t(
        "无法读取这个文件，请重新导出后再试。",
        "Could not read this file. Export it again and retry.",
      );
      const base64 = await fileBase64(targetFile, unreadable).catch(() => {
        throw new Error(unreadable);
      });
      if (!session.alive.current) return;
      await session.accept(await props.previewOnboardingImport(targetSource, targetFile.name, base64));
    } catch (err) {
      const detail = message(err);
      setError(
        (targetSource === "chatgpt-conversations" || targetSource === "nut-ai") &&
          /Unexpected token|Unexpected end|JSON|无法读取 ChatGPT|Nut AI 备份格式|The import file could not be read/.test(
            detail,
          )
          ? t(
              "这个 JSON 读不出来，请确认是完整的 ChatGPT 导出或 Nut AI 备份。",
              "Could not read this JSON. Check that it is a complete ChatGPT export or Nut AI backup.",
            )
          : detail,
      );
      if (!props.source) setNeedsSourceChoice(true);
    } finally {
      setBusy(false);
    }
  }
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  const automaticFile = useRef<File>();
  useEffect(() => {
    if (props.initialFile && props.source && automaticFile.current !== props.initialFile) {
      automaticFile.current = props.initialFile;
      void prepareRef.current(props.initialFile, props.source);
    }
  }, [props.initialFile, props.source]);

  async function handlePickedFile(picked: File | null) {
    setBusy(true);
    setFile(picked);
    setError("");
    setSaved(false);
    await session.clear().catch(() => {});
    if (!picked) {
      setBusy(false);
      setNeedsSourceChoice(false);
      return;
    }
    if (props.source) {
      await prepare(picked, props.source);
      return;
    }
    const detected = await detectFileImportSource(picked).catch(() => "choose" as const);
    if (detected === "choose") {
      const ext = picked.name.split(".").at(-1)?.toLowerCase();
      const fallback: FileImportSource =
        ext === "json" ? "chatgpt-conversations" : ext === "zip" ? "apple-health" : source;
      setBusy(false);
      setSource(fallback);
      setNeedsSourceChoice(true);
      return;
    }
    setSource(detected);
    setNeedsSourceChoice(false);
    await prepare(picked, detected);
  }

  async function confirm() {
    if (!session.preview) return;
    setBusy(true);
    setError("");
    try {
      if (!saved) {
        await props.confirmOnboardingImport(session.preview.token);
        session.consumed();
        setSaved(true);
      }
      await props.onDone();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    setError("");
    try {
      await session.clear();
      props.onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`${css.card} ${css["sub-form"]}`} aria-label={title}>
      <strong>{title}</strong>
      {!props.initialFile && (
        <label>
          {t("选择导出文件", "Choose an export file")}
          <input
            type="file"
            accept={props.source ? sources[props.source].accept : ".ics,.xml,.zip,.json"}
            disabled={busy || !!preview}
            onChange={(event) => void handlePickedFile(event.target.files?.[0] ?? null)}
          />
        </label>
      )}
      {props.initialFile && <p>{file?.name}</p>}
      {!props.source && needsSourceChoice && (
        <label>
          {t("资料类型", "File type")}
          <select
            value={source}
            disabled={busy || !!preview}
            onChange={(event) => setSource(event.target.value as FileImportSource)}
          >
            {Object.entries(sources).map(([id, item]) => (
              <option key={id} value={id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {preview && (
        <div className={styles.preview}>
          <p>
            {t(
              `新增 ${preview.added} · 更新 ${preview.updated} · 跳过 ${preview.skipped}`,
              `Add ${preview.added} · Update ${preview.updated} · Skip ${preview.skipped}`,
            )}
          </p>
          {"types" in preview && (
            <ul className={styles.list}>
              {Object.entries(preview.types).map(([type, count]) => (
                <li key={type}>
                  {type} ·{" "}
                  {t(
                    `新增 ${count.added} · 更新 ${count.updated} · 跳过 ${count.skipped}`,
                    `Add ${count.added} · Update ${count.updated} · Skip ${count.skipped}`,
                  )}
                </li>
              ))}
            </ul>
          )}
          {"entries" in preview && (
            <ul className={styles.list}>
              {preview.entries.map((entry) => (
                <li key={entry.file}>
                  {entry.title} ·{" "}
                  {t(
                    entry.action === "added" ? "新增" : entry.action === "updated" ? "更新" : "跳过",
                    entry.action === "added" ? "Add" : entry.action === "updated" ? "Update" : "Skip",
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {saved && <output>{t("已导入，正在更新清单。", "Imported. Refreshing the list.")}</output>}
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {preview ? (
          <>
            <button type="button" className={primary} disabled={busy} onClick={() => void confirm()}>
              {busy
                ? t("处理中…", "Processing…")
                : saved
                  ? t("重新读取结果", "Reload result")
                  : t("确认导入", "Confirm import")}
            </button>
            {!saved && (
              <button
                type="button"
                className={quiet}
                disabled={busy}
                onClick={() => void session.clear().catch((err) => setError(message(err)))}
              >
                {t("重新预览", "Preview again")}
              </button>
            )}
          </>
        ) : (
          <button type="button" className={primary} disabled={busy || !file} onClick={() => void prepare()}>
            {busy ? t("正在预览…", "Preparing preview…") : t("预览导入", "Preview import")}
          </button>
        )}
        <button type="button" className={quiet} disabled={busy} onClick={() => void close()}>
          {saved ? t("关闭", "Close") : t("取消", "Cancel")}
        </button>
      </div>
    </section>
  );
}

function inferProjectTitle(location: string): string {
  const cleaned = location.trim().replace(/[\\/]+$/, "");
  if (!cleaned) return "";
  return cleaned.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

export function OnboardingSetup(props: OnboardingServices & Completion & { source: "projects" | "news" }) {
  const t = useT();
  const session = usePreview<OnboardingSetupPreview>(props.cancelOnboarding);
  const [mode, setMode] = useState<"folder" | "github">("folder");
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [kind, setKind] = useState<"work" | "learning" | "personal">("work");
  const [path, setPath] = useState("");
  const [github, setGithub] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState("");
  const project = props.source === "projects";
  const locked = busy || !!session.preview;

  const suggestedTitle = inferProjectTitle(mode === "folder" ? path : normalizeGithubRepo(github));
  const title = customTitle ?? suggestedTitle;

  async function prepare() {
    setBusy(true);
    setError("");
    try {
      await session.clear();
      const normalizedGithub = normalizeGithubRepo(github);
      const input: OnboardingSetupInput = project
        ? {
            source: "projects",
            project: {
              title: title.trim() || suggestedTitle,
              kind,
              links: mode === "folder" ? [{ path: path.trim(), role: "folder" }] : [],
            },
            ...(mode === "github" ? { github: normalizedGithub } : {}),
          }
        : {
            source: "news",
            keywords: keywords
              .split(/[\n,，、]/)
              .map((word) => word.trim())
              .filter(Boolean),
          };
      await session.accept(await props.previewOnboardingSetup(input));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!session.preview) return;
    setBusy(true);
    setError("");
    try {
      if (!saved) {
        const result = await props.confirmOnboardingSetup(session.preview.token);
        if (result.github && !result.github.ok) {
          const reason = result.github.error ?? result.github.problem;
          setReceipt(
            t(
              `项目已保存，GitHub 连接未完成：${reason}。请检查后重试连接。`,
              `Project saved, but GitHub connection failed: ${reason}. Check and retry.`,
            ),
          );
          return;
        }
        session.consumed();
        setSaved(true);
        setReceipt("");
      }
      await props.onDone();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    setError("");
    try {
      await session.clear();
      props.onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const heading = project ? t("接上项目", "Connect a project") : t("你想关注哪些方向", "Topics to follow");
  return (
    <section
      className={`${css.card} ${css["sub-form"]}`}
      aria-label={project ? t("接上项目", "Connect a project") : t("设置关注方向", "Set topics to follow")}
    >
      <strong>{heading}</strong>
      {project ? (
        <>
          <div className={styles.actions}>
            <button
              type="button"
              className={mode === "folder" ? primary : quiet}
              aria-pressed={mode === "folder"}
              disabled={locked}
              onClick={() => setMode("folder")}
            >
              {t("本机文件夹", "Local folder")}
            </button>
            <button
              type="button"
              className={mode === "github" ? primary : quiet}
              aria-pressed={mode === "github"}
              disabled={locked}
              onClick={() => setMode("github")}
            >
              {t("GitHub 仓库", "GitHub repository")}
            </button>
          </div>
          {mode === "folder" ? (
            <label>
              {t("项目文件夹", "Project folder")}
              <input
                value={path}
                placeholder={t("/Users/你的名字/项目", "/Users/you/project")}
                disabled={locked}
                onChange={(event) => setPath(event.target.value)}
              />
              <FolderButton disabled={locked} onSelect={setPath} />
            </label>
          ) : (
            <label>
              {t("GitHub 仓库", "GitHub repository")}
              <input
                value={github}
                placeholder={t("owner/repo 或仓库网址", "owner/repo or repository URL")}
                disabled={locked}
                onChange={(event) => setGithub(event.target.value)}
              />
            </label>
          )}
          <div className={css.fields}>
            <label>
              {t("项目名称", "Project name")}
              <input
                value={title}
                disabled={locked}
                onChange={(event) => setCustomTitle(event.target.value)}
                onBlur={() => {
                  if (!customTitle?.trim()) setCustomTitle(null);
                }}
              />
            </label>
            <label>
              {t("项目类型", "Project type")}
              <select
                className={styles.select}
                value={kind}
                disabled={locked}
                onChange={(event) => setKind(event.target.value as "work" | "learning" | "personal")}
              >
                <option value="work">{t("工作项目", "Work")}</option>
                <option value="learning">{t("学习项目", "Learning")}</option>
                <option value="personal">{t("个人项目", "Personal")}</option>
              </select>
            </label>
          </div>
        </>
      ) : (
        <label>
          {t("关注关键词，用逗号或换行分隔", "Keywords, separated by commas or new lines")}
          <textarea
            className={styles.textarea}
            rows={3}
            value={keywords}
            disabled={locked}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                keywords.trim() &&
                !locked
              ) {
                event.preventDefault();
                void prepare();
              }
            }}
            onChange={(event) => setKeywords(event.target.value)}
          />
        </label>
      )}
      {session.preview && (
        <div className={styles.preview}>
          {session.preview.input.source === "projects" ? (
            <p>
              {t(
                `将添加项目「${session.preview.input.project.title}」，${
                  session.preview.input.github
                    ? `连接 GitHub 仓库 ${session.preview.input.github}`
                    : "连接本机文件夹"
                }。`,
                `Add project “${session.preview.input.project.title}” (${
                  session.preview.input.github ? `GitHub ${session.preview.input.github}` : "local folder"
                }).`,
              )}
            </p>
          ) : (
            <p>
              {t(
                `将关注：${session.preview.input.keywords.join("、")}`,
                `Follow: ${session.preview.input.keywords.join(", ")}`,
              )}
            </p>
          )}
        </div>
      )}
      {receipt && <output>{receipt}</output>}
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {session.preview ? (
          <>
            <button type="button" className={primary} disabled={busy} onClick={() => void confirm()}>
              {busy
                ? t("处理中…", "Processing…")
                : saved
                  ? t("完成", "Done")
                  : receipt
                    ? t("重试连接", "Retry connection")
                    : t("确认保存", "Confirm and save")}
            </button>
            {!saved && !receipt && (
              <button
                type="button"
                className={quiet}
                disabled={busy}
                onClick={() => void session.clear().catch((err) => setError(message(err)))}
              >
                {t("修改", "Edit")}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className={primary}
            disabled={
              busy || (project ? !(mode === "folder" ? path.trim() : github.trim()) : !keywords.trim())
            }
            onClick={() => void prepare()}
          >
            {busy ? t("正在预览…", "Preparing preview…") : t("预览", "Preview")}
          </button>
        )}
        <button type="button" className={quiet} disabled={busy} onClick={() => void close()}>
          {saved ? t("关闭", "Close") : t("取消", "Cancel")}
        </button>
      </div>
    </section>
  );
}
