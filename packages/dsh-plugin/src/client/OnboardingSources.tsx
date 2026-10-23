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

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("无法读取文件"));
    reader.onabort = () => reject(new Error("已取消读取文件"));
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

export function OnboardingFileImport(props: FileImportServices & Completion & { source?: FileImportSource }) {
  const t = useT();
  const [source, setSource] = useState<FileImportSource>(props.source ?? "ics");
  const sources = {
    "apple-health": { name: t("Apple 健康", "Apple Health"), accept: ".zip,.xml" },
    "chatgpt-conversations": { name: t("ChatGPT 对话", "ChatGPT conversations"), accept: ".zip,.json" },
    ics: { name: t("日历 ICS", "Calendar ICS"), accept: ".ics" },
    "nut-ai": { name: t("Nut AI 备份", "Nut AI backup"), accept: ".json" },
  } satisfies Record<FileImportSource, { name: string; accept: string }>;
  const title = t("导入 ", "Import ") + sources[source].name;
  const session = usePreview<OnboardingImportPreview>(props.cancelOnboarding);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const preview = session.preview?.preview;
  async function prepare() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await session.clear();
      const base64 = await fileBase64(file);
      if (!session.alive.current) return;
      await session.accept(await props.previewOnboardingImport(source, file.name, base64));
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
      {!props.source && (
        <label>
          {t("资料类型", "File type")}
          <select
            value={source}
            disabled={busy || !!preview}
            onChange={(event) => {
              setSource(event.target.value as FileImportSource);
              setFile(null);
            }}
          >
            {Object.entries(sources).map(([id, item]) => (
              <option key={id} value={id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        {t("选择导出文件", "Choose an export file")}
        <input
          key={source}
          type="file"
          accept={sources[source].accept}
          disabled={busy || !!preview}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {preview && (
        <div className={styles.preview}>
          <p>
            新增 {preview.added} · 更新 {preview.updated} · 跳过 {preview.skipped}
          </p>
          {"types" in preview && (
            <ul className={styles.list}>
              {Object.entries(preview.types).map(([type, count]) => (
                <li key={type}>
                  {type}：新增 {count.added} · 更新 {count.updated} · 跳过 {count.skipped}
                </li>
              ))}
            </ul>
          )}
          {"entries" in preview && (
            <ul className={styles.list}>
              {preview.entries.map((entry) => (
                <li key={entry.file}>
                  {entry.title} ·{" "}
                  {entry.action === "added" ? "新增" : entry.action === "updated" ? "更新" : "跳过"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {saved && <output>已导入，正在更新清单。</output>}
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        {preview ? (
          <>
            <button type="button" className={primary} disabled={busy} onClick={() => void confirm()}>
              {busy ? "处理中…" : saved ? "重新读取结果" : "确认导入"}
            </button>
            {!saved && (
              <button
                type="button"
                className={quiet}
                disabled={busy}
                onClick={() => void session.clear().catch((err) => setError(message(err)))}
              >
                重新选择
              </button>
            )}
          </>
        ) : (
          <button type="button" className={primary} disabled={busy || !file} onClick={() => void prepare()}>
            {busy ? "正在预览…" : "预览导入"}
          </button>
        )}
        <button type="button" className={quiet} disabled={busy} onClick={() => void close()}>
          {saved ? "关闭" : "取消"}
        </button>
      </div>
    </section>
  );
}

export function OnboardingSetup(props: OnboardingServices & Completion & { source: "projects" | "news" }) {
  const session = usePreview<OnboardingSetupPreview>(props.cancelOnboarding);
  const [mode, setMode] = useState<"folder" | "github">("folder");
  const [title, setTitle] = useState("");
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
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      await session.clear();
      const input: OnboardingSetupInput = project
        ? {
            source: "projects",
            project: {
              title: title.trim(),
              kind,
              links: mode === "folder" ? [{ path: path.trim(), role: "folder" }] : [],
            },
            ...(mode === "github" ? { github: github.trim() } : {}),
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
          setReceipt(
            `项目已保存，GitHub 连接未完成：${result.github.error ?? result.github.problem}。请检查后重试连接。`,
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
  return (
    <section className={`${css.card} ${css["sub-form"]}`} aria-label={project ? "接上项目" : "设置关注方向"}>
      <strong>{project ? "接上项目" : "你想关注哪些方向"}</strong>
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
              本机文件夹
            </button>
            <button
              type="button"
              className={mode === "github" ? primary : quiet}
              aria-pressed={mode === "github"}
              disabled={locked}
              onClick={() => setMode("github")}
            >
              GitHub 仓库
            </button>
          </div>
          <div className={css.fields}>
            <label>
              项目名称
              <input value={title} disabled={locked} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              项目类型
              <select
                className={styles.select}
                value={kind}
                disabled={locked}
                onChange={(event) => setKind(event.target.value as "work" | "learning" | "personal")}
              >
                <option value="work">工作项目</option>
                <option value="learning">学习项目</option>
                <option value="personal">个人项目</option>
              </select>
            </label>
          </div>
          {mode === "folder" ? (
            <label>
              项目文件夹
              <input
                value={path}
                placeholder="/Users/你的名字/项目"
                disabled={locked}
                onChange={(event) => setPath(event.target.value)}
              />
              <FolderButton disabled={locked} onSelect={setPath} />
            </label>
          ) : (
            <label>
              GitHub 仓库
              <input
                value={github}
                placeholder="owner/repo 或仓库网址"
                disabled={locked}
                onChange={(event) => setGithub(event.target.value)}
              />
            </label>
          )}
        </>
      ) : (
        <label>
          关注关键词，用逗号或换行分隔
          <textarea
            className={styles.textarea}
            rows={3}
            value={keywords}
            disabled={locked}
            onChange={(event) => setKeywords(event.target.value)}
          />
        </label>
      )}
      {session.preview && (
        <div className={styles.preview}>
          {session.preview.input.source === "projects" ? (
            <p>
              将添加项目「{session.preview.input.project.title}」，
              {session.preview.input.github
                ? `连接 GitHub 仓库 ${session.preview.input.github}`
                : "连接本机文件夹"}
              。
            </p>
          ) : (
            <p>将关注：{session.preview.input.keywords.join("、")}</p>
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
              {busy ? "处理中…" : saved ? "完成" : receipt ? "重试连接" : "确认保存"}
            </button>
            {!saved && !receipt && (
              <button
                type="button"
                className={quiet}
                disabled={busy}
                onClick={() => void session.clear().catch((err) => setError(message(err)))}
              >
                修改
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className={primary}
            disabled={
              busy ||
              (project
                ? !title.trim() || !(mode === "folder" ? path.trim() : github.trim())
                : !keywords.trim())
            }
            onClick={() => void prepare()}
          >
            {busy ? "正在预览…" : "预览"}
          </button>
        )}
        <button type="button" className={quiet} disabled={busy} onClick={() => void close()}>
          {saved ? "关闭" : "取消"}
        </button>
      </div>
    </section>
  );
}
