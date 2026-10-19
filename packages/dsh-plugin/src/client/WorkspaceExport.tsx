import type { WorkspaceExportState } from "@kaitu/core";
import { useCallback, useEffect, useRef, useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export function WorkspaceExport({
  request,
}: {
  request: (action: "start" | "status" | "cancel" | "result") => Promise<WorkspaceExportState>;
}) {
  const t = useT();
  const sequence = useRef(0);
  const [state, setState] = useState<WorkspaceExportState>({ status: "idle" });
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    const current = sequence.current;
    void request("status")
      .then((next) => {
        if (current === sequence.current)
          setState((previous) =>
            previous.status === "downloading" && next.status === "ready" ? previous : next,
          );
      })
      .catch((e) => {
        if (current === sequence.current) setError(e.message);
      });
  }, [request]);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => {
    if (state.status !== "running" && state.status !== "downloading") return;
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, [refresh, state.status]);
  const run = async (action: "start" | "cancel" | "result") => {
    const current = ++sequence.current;
    setError("");
    if (action === "start") setState({ status: "running", progress: { phase: "read", completed: 0 } });
    try {
      const result = await request(action);
      if (sequence.current !== current) return;
      setState(result);
      if (result.file) {
        const link = document.createElement("a");
        link.href = result.file.url;
        link.download = result.file.name;
        link.rel = "noreferrer";
        link.click();
        setState({ status: "downloading" });
      }
    } catch (e) {
      if (current !== sequence.current) return;
      setState({ status: "failed" });
      setError((e as Error).message);
    }
  };
  return (
    <div className={css["switch-row"]}>
      <span>
        <b>{t("导出全部资料", "Export everything")}</b>
        {state.status === "running" && (
          <output aria-live="polite">
            {state.progress?.phase === "compress"
              ? t(
                  `正在压缩，已读取 ${((state.progress.bytes ?? 0) / 1000000).toFixed(1)} MB，完成 ${state.progress.completed} 份`,
                  `Compressing; read ${((state.progress.bytes ?? 0) / 1000000).toFixed(1)} MB, completed ${state.progress.completed} files`,
                )
              : t(
                  `已读取 ${state.progress?.completed ?? 0} 份资料`,
                  `Read ${state.progress?.completed ?? 0} files`,
                )}
          </output>
        )}
        {state.status === "downloading" && (
          <output aria-live="polite">{t("正在下载 ZIP…", "Downloading ZIP…")}</output>
        )}
        {state.status === "ready" && <output>{t("导出文件已生成", "Export ready")}</output>}
        {state.status === "cancelled" && <output>{t("导出已取消", "Export cancelled")}</output>}
        {(error || state.status === "failed") && (
          <p role="alert">
            {error ||
              t("导出未完成，请检查资料可用性后重试", "Export incomplete; check file availability and retry")}
          </p>
        )}
      </span>
      {state.status === "running" || state.status === "downloading" ? (
        <button type="button" className={css.link} onClick={() => void run("cancel")}>
          {state.status === "downloading" ? t("取消下载", "Cancel download") : t("取消导出", "Cancel export")}
        </button>
      ) : (
        <button
          type="button"
          className={`${css.btn} ${css["btn-quiet"]}`}
          onClick={() => void run(state.status === "ready" ? "result" : "start")}
        >
          {state.status === "ready" ? t("下载 ZIP", "Download ZIP") : t("导出", "Export")}
        </button>
      )}
    </div>
  );
}
