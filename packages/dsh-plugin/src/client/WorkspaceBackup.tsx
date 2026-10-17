import type { workspaceBackupStatus } from "@kaitu/core";
import { useCallback, useEffect, useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";
type Status = ReturnType<typeof workspaceBackupStatus>;
export type WorkspaceBackupRequest = (operation: string, input?: Record<string, unknown>) => Promise<unknown>;
export function WorkspaceBackup({
  request,
  subscribe,
  pickFolder,
  onActivated,
}: {
  request: WorkspaceBackupRequest;
  subscribe?: (refresh: () => void) => () => void;
  pickFolder: () => Promise<string | null>;
  onActivated: () => Promise<void>;
}) {
  const t = useT();
  const [status, setStatus] = useState<Status>();
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [text, setText] = useState(true);
  const [records, setRecords] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [restored, setRestored] = useState("");
  const refresh = useCallback(() => {
    void request("status")
      .then((s) => setStatus(s as Status))
      .catch((e) => setMessage((e as Error).message));
  }, [request]);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => subscribe?.(refresh), [subscribe, refresh]);
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    setBusy(true);
    setMessage("");
    try {
      const r = await request(action, input);
      setToken("");
      if (action === "restore") setRestored((r as { root: string }).root);
      else setStatus(r as Status);
      if (action === "activate") {
        setRestored("");
        await onActivated();
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const c = status?.connection;
  return (
    <section className={css.sec}>
      <h2 className={css.eyebrow}>{t("GitHub 备份", "GitHub backup")}</h2>
      <div className={`${css.card} ${css["sub-form"]}`}>
        {c && (
          <p>
            {c.repo} · {c.private ? t("私有仓库", "Private repository") : t("公开仓库", "Public repository")}{" "}
            ·{" "}
            {status.running
              ? t("正在同步…", "Syncing…")
              : c.enabled
                ? t("已连接", "Connected")
                : t("上传未开启", "Upload disabled")}
            {status.lastSync && ` · ${new Date(status.lastSync).toLocaleString()}`}
          </p>
        )}
        {status?.error && (
          <p className={css.error} role="alert">
            {status.error}
          </p>
        )}
        {c && !c.private && !c.enabled && (
          <p role="alert">{t("公开仓库，未开启上传", "Public repository; upload is off")}</p>
        )}
        <details open={!c}>
          <summary>
            {c
              ? t("更换仓库 / 从备份恢复", "Change repository / restore backup")
              : t("连接仓库 / 从备份恢复", "Connect / restore")}
          </summary>
          <label>
            {t("仓库（owner/repo）", "Repository (owner/repo)")}
            <input
              aria-label={t("备份仓库", "Backup repository")}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/kaitu-backup"
            />
          </label>
          <label>
            GitHub token
            <input
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p className={css.small}>
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
              {t("在 GitHub 创建 token", "Create a token on GitHub")}
            </a>
          </p>
          <label>
            <input type="checkbox" checked={text} onChange={(e) => setText(e.target.checked)} />
            {t("文字（Markdown / TXT）", "Text (Markdown / TXT)")}
          </label>{" "}
          <label>
            <input type="checkbox" checked={records} onChange={(e) => setRecords(e.target.checked)} />
            {t("结构化资料（JSON / JSONL 等）", "Structured data (JSON / JSONL, etc.)")}
          </label>
          <p>
            <button
              className={`${css.btn} ${css["btn-quiet"]}`}
              type="button"
              disabled={busy || status?.running || !repo.trim()}
              onClick={() => void run("connect", { repo, token, text, records })}
            >
              {busy ? t("正在处理…", "Working…") : t("检查并连接", "Check and connect")}
            </button>{" "}
            <button
              className={`${css.btn} ${css["btn-quiet"]}`}
              type="button"
              disabled={busy || status?.running || !repo.trim()}
              onClick={() =>
                void (async () => {
                  const folder = await pickFolder();
                  if (folder) await run("restore", { repo, token, root: folder });
                })()
              }
            >
              {t("从仓库恢复到新目录", "Restore into a new folder")}
            </button>
          </p>
        </details>
        {c && !c.enabled && !c.private && (
          <button
            className={`${css.btn} ${css["btn-quiet"]}`}
            type="button"
            disabled={busy}
            onClick={() =>
              void run("connect", { repo: c.repo, text: c.text, records: c.records, allowPublic: true })
            }
          >
            {t("我允许内容公开，启用同步", "Allow public contents and enable sync")}
          </button>
        )}
        {c?.enabled && (
          <button
            className={`${css.btn} ${css["btn-quiet"]}`}
            type="button"
            disabled={busy || status?.running || !!status?.conflicts.length}
            onClick={() => void run("sync")}
          >
            {t("立即同步", "Sync now")}
          </button>
        )}{" "}
        {c && (
          <button
            className={`${css.btn} ${css["btn-quiet"]}`}
            type="button"
            disabled={busy || status?.running}
            onClick={() => void run("disconnect")}
          >
            {t("断开备份连接", "Disconnect backup")}
          </button>
        )}
        {status?.conflicts.map((conflict) => (
          <details key={conflict.path} open>
            <summary>
              {conflict.path} ·{" "}
              {conflict.reason === "record"
                ? t("同一条记录在两端修改或删除", "The same record was edited or deleted on both devices")
                : t("两端都有修改", "Changed on both devices")}
            </summary>
            <details>
              <summary>{t("本机版本", "Local version")}</summary>
              <pre className={css.pre}>{conflict.local ?? t("已删除", "Deleted")}</pre>
            </details>
            <details>
              <summary>{t("远端版本", "Remote version")}</summary>
              <pre className={css.pre}>{conflict.remote ?? t("已删除", "Deleted")}</pre>
            </details>
            <button
              className={`${css.btn} ${css["btn-quiet"]}`}
              type="button"
              disabled={busy}
              onClick={() => void run("resolve", { path: conflict.path, choice: "local" })}
            >
              {t("保留本机文件", "Keep local file")}
            </button>{" "}
            <button
              className={`${css.btn} ${css["btn-quiet"]}`}
              type="button"
              disabled={busy}
              onClick={() => void run("resolve", { path: conflict.path, choice: "remote" })}
            >
              {t("采用远端文件", "Use remote file")}
            </button>
          </details>
        ))}
        {restored && (
          <output>
            {t("已恢复到：", "Restored to: ")}
            {restored}
            <button
              className={`${css.btn} ${css["btn-quiet"]}`}
              type="button"
              disabled={busy}
              onClick={() => void run("activate", { root: restored })}
            >
              {t("打开恢复的工作区", "Open restored workspace")}
            </button>
          </output>
        )}
        {message && (
          <p className={css.error} role="alert">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
