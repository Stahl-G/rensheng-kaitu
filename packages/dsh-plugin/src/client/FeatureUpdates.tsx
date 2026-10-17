import { useEffect, useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export interface FeatureUpdateState {
  version: string;
  dshVersion: string;
  configured: boolean;
  phase: string;
  availableVersion: string | null;
  notes: string;
  error: string;
  canRollback: boolean;
}
export type FeatureUpdateRequest = (action: string) => Promise<FeatureUpdateState | null>;

export function FeatureUpdates({ request }: { request: FeatureUpdateRequest }) {
  const t = useT();
  const [state, setState] = useState<FeatureUpdateState | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const busy = sending || state?.phase === "checking" || state?.phase === "downloading";
  useEffect(() => {
    let active = true;
    void request("status")
      .then((value) => active && setState(value))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
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
  return (
    <div className={`${css.card} ${css.sum}`}>
      <b>{t("开图功能更新", "Kaitu feature updates")}</b>
      <p className={css.small}>
        {t("功能版本", "Feature version")} {state.version} · {t("固定内核", "Pinned engine")} DSH{" "}
        {state.dshVersion}
      </p>
      {!state.configured && <p className={css.small}>{t("未配置更新源", "No update source configured")}</p>}
      {state.phase === "current" && <p>{t("已是最新功能版本", "Features are up to date")}</p>}
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
      </div>
    </div>
  );
}
