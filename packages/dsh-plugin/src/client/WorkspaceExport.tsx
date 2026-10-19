import type { WorkspaceExportState } from "@kaitu/core";
import { useCallback, useEffect, useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export function WorkspaceExport({
  request,
}: {
  request: (action: "start" | "status" | "cancel" | "result") => Promise<WorkspaceExportState>;
}) {
  const t = useT();
  const [state, setState] = useState<WorkspaceExportState>({ status: "idle" });
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    void request("status")
      .then(setState)
      .catch((e) => setError(e.message));
  }, [request]);
  useEffect(() => refresh(), [refresh]);
  useEffect(() => {
    if (state.status !== "running") return;
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, [refresh, state.status]);
  const run = async (action: "start" | "cancel" | "result") => {
    setError("");
    if (action === "start") setState({ status: "running", progress: { phase: "read", completed: 0 } });
    try {
      const result = await request(action);
      setState(result);
      if (result.file) {
        const bytes = Uint8Array.from(atob(result.file.base64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = result.file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setState({ status: "idle" });
      }
    } catch (e) {
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
              ? t("正在压缩…", "Compressing…")
              : t(
                  `已读取 ${state.progress?.completed ?? 0} 份资料`,
                  `Read ${state.progress?.completed ?? 0} files`,
                )}
          </output>
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
      {state.status === "running" ? (
        <button type="button" className={css.link} onClick={() => void run("cancel")}>
          {t("取消导出", "Cancel export")}
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
