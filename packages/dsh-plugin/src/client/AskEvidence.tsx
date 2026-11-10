import css from "./AskPage.module.css";
import type { AskEvidenceItem } from "./ask-evidence.js";
import { useT } from "./i18n.js";

export function AskEvidence({ items, onToday }: { items: AskEvidenceItem[]; onToday?: () => void }) {
  const t = useT();
  if (!items.length) return null;
  const labels: Record<string, string> = {
    kaitu_status: t("开图现状", "Kaitu status"),
    kaitu_life_map: t("足迹", "Footprints"),
    kaitu_exploration_read: t("方向与尝试", "Directions and experiments"),
    kaitu_records: t("记录", "Records"),
    kaitu_tasks: t("待办", "Tasks"),
    kaitu_search_chats: t("历史对话", "Past conversations"),
    kaitu_workspace: t("开图资料", "Kaitu files"),
    kaitu_learning: t("学习记录", "Learning"),
    kaitu_onboarding: t("整理草稿", "Organizing draft"),
    kaitu_import: t("导入预览", "Import preview"),
    kaitu_restore: t("恢复建议", "Restore proposal"),
  };
  const states = {
    reading: t("处理中", "In progress"),
    read: t("已读", "Read"),
    saved: t("已保存", "Saved"),
    proposed: t("建议已保存", "Suggestion saved"),
    preview: t("待核对", "To review"),
    failed: t("未完成", "Failed"),
    stopped: t("已中断", "Stopped"),
    unknown: t("查看结果", "View result"),
  };
  return (
    <aside className={css.evidencePanel} aria-label={t("来源与写回", "Sources and writes")}>
      {(["read", "write"] as const).map((lane) => {
        const rows = items.filter((item) => item.lane === lane);
        if (!rows.length) return null;
        return (
          <section key={lane}>
            <h2>{lane === "read" ? t("读过", "Sources") : t("写回", "Writes")}</h2>
            {rows.map((item) => (
              <details key={item.id} className={css.evidenceItem} data-state={item.state}>
                <summary>
                  <span className={css.evidenceTitle}>{item.target || labels[item.name] || item.name}</span>
                  <span>{states[item.state]}</span>
                </summary>
                <pre>{item.detail || item.name}</pre>
                {item.task && item.state === "proposed" && onToday && (
                  <button type="button" onClick={onToday}>
                    {t("到今天核对", "Review in Today")}
                  </button>
                )}
              </details>
            ))}
          </section>
        );
      })}
    </aside>
  );
}
