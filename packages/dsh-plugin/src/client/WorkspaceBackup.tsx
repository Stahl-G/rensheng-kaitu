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
      <h2 className={css.eyebrow}>
        {t("GitHub 工作区备份（开发者可选）", "GitHub workspace backup (optional)")}
      </h2>
      <div className={css.card} style={{ padding: 20 }}>
        <p>
          {t(
            "只同步所选文字和结构化资料。密钥、凭据、本机状态、内部历史及媒体文件留在本机。",
            "Sync selected text and structured data. Credentials, local state, internal history and media stay on this device.",
          )}
        </p>
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
        {status?.error && <p role="alert">{status.error}</p>}
        {c && !c.private && !c.enabled && (
          <p role="alert">
            {t(
              "这是公开仓库，备份内容会对外可见。默认未开启上传，请换成私库，或主动选择允许公开同步。",
              "This is a public repository: backup contents would be public. Upload is disabled. Choose a private repository or explicitly allow public sync.",
            )}
          </p>
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
              style={{
                padding: "8px 10px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--surface)",
              }}
              aria-label={t("备份仓库", "Backup repository")}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/kaitu-backup"
            />
          </label>
          <label>
            {t("GitHub token（留空复用已有凭据）", "GitHub token (leave blank to reuse saved credentials)")}
            <input
              style={{
                padding: "8px 10px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--surface)",
              }}
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <p className={css.small}>
            {t(
              "授权时只选目标仓库，Contents 设为 Read and write；token 仅保存在本机。",
              "Authorize only the selected repository with Contents: Read and write. The token is saved locally.",
            )}{" "}
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
              {t("在 GitHub 创建授权", "Authorize on GitHub")}
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
            <p>
              {t(
                "两份内容已保留，本次上传暂停。请选择这个文件要保留的版本。",
                "Both versions are kept; upload is paused. Choose the version to keep for this file.",
              )}
            </p>
            <details>
              <summary>{t("本机版本", "Local version")}</summary>
              <pre style={{ whiteSpace: "pre-wrap", maxHeight: 250, overflow: "auto" }}>
                {conflict.local ?? t("已删除", "Deleted")}
              </pre>
            </details>
            <details>
              <summary>{t("远端版本", "Remote version")}</summary>
              <pre style={{ whiteSpace: "pre-wrap", maxHeight: 250, overflow: "auto" }}>
                {conflict.remote ?? t("已删除", "Deleted")}
              </pre>
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
        {message && <p role="alert">{message}</p>}
      </div>
    </section>
  );
}
