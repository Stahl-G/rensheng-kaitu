import { useEffect, useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export interface FeatureUpdateState {
  version: string;
  dshVersion: string;
  configured: boolean;
  automatic: boolean;
  phase: string;
  availableVersion: string | null;
  notes: string;
  error: string;
  canRollback: boolean;
}
export type FeatureUpdateRequest = (action: string) => Promise<FeatureUpdateState | null>;

export function FeatureUpdates({
  request,
  compact = false,
}: { request: FeatureUpdateRequest; compact?: boolean }) {
  const t = useT();
  const [state, setState] = useState<FeatureUpdateState | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [acted, setActed] = useState(false);
  const busy = sending || state?.phase === "checking" || state?.phase === "downloading";
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void request("status")
        .then((value) => active && setState(value))
        .catch((err) => active && setError(err.message));
    refresh();
    // Status is in memory. Network checks run in the desktop process, independently of this view.
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [request]);
  useEffect(() => {
    if (state?.phase !== "checking" && state?.phase !== "downloading") return;
    const timer = setInterval(() => {
      void request("status")
        .then(setState)
        .catch((err) => setError(err.message));
    }, 750);
    return () => clearInterval(timer);
  }, [request, state?.phase]);
  const run = async (action: string) => {
    setActed(true);
    setSending(true);
    setError("");
    try {
      setState(await request(action));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };
  if (!state) return error ? <p role="alert">{error}</p> : null;
  const notice = `${state.phase}:${state.availableVersion}`;
  if (
    compact &&
    (!state.configured ||
      notice === dismissed ||
      !(
        ["available", "downloading", "ready"].includes(state.phase) ||
        (acted && (error || state.error || state.phase === "unavailable"))
      ))
  )
    return null;
  return (
    <div className={`${css.card} ${css.sum}`} role={compact ? "status" : undefined}>
      <b>{t("开图功能更新", "Kaitu feature updates")}</b>
      {!compact && (
        <>
          <p className={css.small}>
            {t("功能版本", "Feature version")} {state.version} · {t("固定内核", "Pinned engine")} DSH{" "}
            {state.dshVersion}
          </p>
          <label className={css.small}>
            <input
              type="checkbox"
              checked={state.automatic}
              disabled={busy || !state.configured}
              onChange={(event) => void run(event.target.checked ? "automatic:on" : "automatic:off")}
            />
            {t("自动检查更新", "Automatically check for updates")}
          </label>
        </>
      )}
      {!state.configured && <p className={css.small}>{t("未配置更新源", "No update source configured")}</p>}
      {state.phase === "current" && <p>{t("已是最新功能版本", "Features are up to date")}</p>}
      {state.phase === "unavailable" && <p>{t("暂无可用更新", "No update available yet")}</p>}
      {state.phase === "checking" && <output>{t("正在检查更新…", "Checking for updates…")}</output>}
      {state.phase === "downloading" && (
        <output>{t("正在下载并验证更新…", "Downloading and verifying…")}</output>
      )}
      {state.phase === "available" && (
        <p>
          {t("可更新到", "Update available:")} {state.availableVersion}
        </p>
      )}
      {state.notes && <p className={css.small}>{state.notes}</p>}
      {(error || state.error) && <p role="alert">{error || state.error}</p>}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {state.phase === "ready" ? (
          <>
            <output>{t("已准备好，重启后生效。", "Ready. Restart to apply.")}</output>
            <button type="button" className={css.btn} disabled={busy} onClick={() => void run("restart")}>
              {t("重启应用", "Restart app")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={css.btn}
              disabled={busy || !state.configured}
              onClick={() => void run("check")}
            >
              {t("检查更新", "Check for updates")}
            </button>
            {state.phase === "available" && (
              <button type="button" className={css.btn} disabled={busy} onClick={() => void run("install")}>
                {t("下载更新", "Download update")}
              </button>
            )}
          </>
        )}
        {state.canRollback && (
          <button type="button" className={css.link} disabled={busy} onClick={() => void run("rollback")}>
            {t("恢复上一版功能", "Restore previous features")}
          </button>
        )}
        {compact && !busy && (
          <button type="button" className={css.link} onClick={() => setDismissed(notice)}>
            {state.phase === "ready" ? t("稍后重启", "Restart later") : t("稍后", "Later")}
          </button>
        )}
      </div>
    </div>
  );
}
