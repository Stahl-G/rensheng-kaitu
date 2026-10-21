import { useCallback, useEffect, useRef, useState } from "react";
import type { ExperienceBatchPreview, ExperienceImportsData } from "../types.js";
import css from "./MapPage.module.css";
import { useT } from "./i18n.js";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ExperienceBatchItemPreview({ item }: { item: ExperienceBatchPreview["affected"][number] }) {
  const t = useT();
  const eventTypes = {
    lived: t("住过", "Lived"),
    worked: t("工作", "Worked"),
    studied: t("求学", "Studied"),
    travel: t("旅行", "Travel"),
    visit: t("到访", "Visited"),
    other: t("其他", "Other"),
  };
  return (
    <p className={css.source}>
      <strong>
        {item.city}
        {item.country ? ` (${item.country})` : ""}
      </strong>
      {" · "}
      {eventTypes[item.event_type]}
      {" · "}
      {item.start || t("开始日期未知", "Unknown start")}
      {item.end && item.end !== item.start ? ` – ${item.end}` : ""}
      {item.title !== item.city ? ` · ${item.title}` : ""}
      {" · "}
      {item.source === "apple-photos" ? t("照片", "Photos") : item.source}
    </p>
  );
}

export interface ExperienceImportControlProps {
  loadExperienceImports: () => Promise<ExperienceImportsData>;
  previewExperienceBatch: (
    id: string,
    operation: "confirm" | "undo" | "restore",
  ) => Promise<ExperienceBatchPreview>;
  setExperienceSource: (locator: string, excluded: boolean, revision: number) => Promise<unknown>;
  changeExperienceBatch: (
    id: string,
    operation: "confirm" | "undo" | "restore",
    revision: number,
  ) => Promise<{
    affected: number;
    preserved: number;
    version: string | null;
  }>;
  recoverExperienceImports: () => Promise<{ recovered: number }>;
}

export function ExperienceImportControls(
  props: ExperienceImportControlProps & {
    subscribe?: (refresh: () => void) => () => void;
    onChanged: () => Promise<void>;
    pending: number;
    reviewPending: number;
  },
) {
  const t = useT();
  const sourceName = (locator: string) => (locator === "apple-photos" ? t("照片", "Photos") : locator);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (props.pending > 0 || props.reviewPending > 0) setOpen(true);
  }, [props.pending, props.reviewPending]);
  const [data, setData] = useState<ExperienceImportsData | null>(null);
  const [preview, setPreview] = useState<ExperienceBatchPreview | null>(null);
  const [source, setSource] = useState<ExperienceImportsData["sources"][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);
  const [previewLimit, setPreviewLimit] = useState(20);
  const [sourceLimit, setSourceLimit] = useState(10);
  const confirmation = useRef<HTMLElement>(null);
  useEffect(() => {
    if (source || preview) confirmation.current?.focus();
  }, [source, preview]);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const result = await props.loadExperienceImports();
      if (seq === sequence.current) {
        setData(result);
        setError(null);
      }
    } catch (error) {
      if (seq === sequence.current) setError(error instanceof Error ? error.message : String(error));
    }
  }, [props.loadExperienceImports]);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const unsubscribe = props.subscribe?.(() => void refresh());
    return () => {
      sequence.current++;
      unsubscribe?.();
    };
  }, [open, props.subscribe, refresh]);
  const perform = async (operation: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await operation();
      setPreview(null);
      setSource(null);
      setNotice(message);
      await props.onChanged();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const loadPreview = (id: string, operation: "confirm" | "undo" | "restore") => {
    setSource(null);
    setNotice(null);
    setPreviewLimit(20);
    setBusy(true);
    setError(null);
    void props
      .previewExperienceBatch(id, operation)
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <details open={open} className={css.review} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("来源与导入", "Sources and imports")}</summary>
      {open && (
        <section aria-label={t("足迹来源与导入", "Footprint sources and imports")} aria-busy={busy}>
          {error && (
            <p className={css.notice} role="alert">
              {error}{" "}
              <button type="button" className={css.link} disabled={busy} onClick={() => void refresh()}>
                {t("重新读取", "Reload")}
              </button>
            </p>
          )}
          {notice && <output className={css.notice}>{notice}</output>}
          {!data ? (
            <p className={css.secondary}>{t("正在读取来源…", "Loading sources…")}</p>
          ) : (
            <>
              {data.pending.length > 0 && (
                <div className={css.reviewItem}>
                  <strong>
                    {t(
                      `${data.pending.length} 次导入操作尚未完成`,
                      `${count(data.pending.length, "import", "imports")} to finish`,
                    )}
                  </strong>
                  <p className={css.secondary}>
                    {t(
                      "从上次进度继续，保留已保存的经历。",
                      "Continue from the last saved step, keeping saved places.",
                    )}
                  </p>
                  <button
                    type="button"
                    className={css.control}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await props.recoverExperienceImports();
                        return t(
                          `已完成 ${result.recovered} 次导入操作`,
                          `Completed ${count(result.recovered, "import", "imports")}`,
                        );
                      })
                    }
                  >
                    {t("继续完成导入", "Resume imports")}
                  </button>
                </div>
              )}
              {source && (
                <section
                  ref={confirmation}
                  tabIndex={-1}
                  className={css.notice}
                  aria-label={t("来源变更确认", "Confirm source change")}
                >
                  <strong>
                    {source.excluded
                      ? t("重新启用来源", "Re-enable source")
                      : t("排除来源", "Exclude source")}
                  </strong>
                  <p className={css.source}>{sourceName(source.locator)}</p>
                  <p>
                    {source.excluded
                      ? t(
                          "允许从这份资料新增足迹。已隐藏或已撤销的经历仍保留当前状态。",
                          "Allow new places from this source. Hidden or undone places keep their current state.",
                        )
                      : t(
                          `停止从这份资料新增足迹，包括其他原文定位行。已有 ${source.active} 段经历保留。`,
                          `Stop adding places from all locations in this source. Keep ${count(source.active, "existing place", "existing places")}.`,
                        )}
                  </p>
                  <div className={css.actions}>
                    <button
                      type="button"
                      className={css.control}
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await props.setExperienceSource(source.locator, !source.excluded, source.revision);
                          return source.excluded
                            ? t("来源已重新启用", "Source re-enabled")
                            : t("来源已排除，已有经历保留", "Source excluded; existing places kept");
                        })
                      }
                    >
                      {source.excluded
                        ? t("确认启用", "Confirm enable")
                        : t("确认排除来源", "Confirm exclusion")}
                    </button>
                    <button
                      type="button"
                      className={css.link}
                      disabled={busy}
                      onClick={() => setSource(null)}
                    >
                      {t("取消", "Cancel")}
                    </button>
                  </div>
                </section>
              )}
              {preview && (
                <section
                  ref={confirmation}
                  tabIndex={-1}
                  className={css.notice}
                  aria-label={t("导入影响预览", "Import impact preview")}
                >
                  <strong>
                    {preview.operation === "confirm"
                      ? t("这批全部确认", "Confirm this batch")
                      : preview.operation === "undo"
                        ? t("撤销这次导入", "Undo this import")
                        : t("恢复这次导入", "Restore this import")}
                  </strong>
                  <p>
                    {preview.operation === "confirm" ? (
                      t(
                        `将确认 ${preview.affected.length} 段经历，保留 ${preview.preserved.length} 段已修改、隐藏、无需确认或城市未解析的资料。`,
                        `Confirm ${count(preview.affected.length, "place", "places")}; preserve ${preview.preserved.length} edited, hidden, unresolved or other ${preview.preserved.length === 1 ? "place" : "places"}.`,
                      )
                    ) : (
                      <>
                        {t(
                          `${preview.operation === "undo" ? "将隐藏" : "将恢复"} ${preview.affected.length} 段经历，保留 ${preview.preserved.length} 段后续已修改的资料或隐藏状态。`,
                          `${preview.operation === "undo" ? "Hide" : "Restore"} ${count(preview.affected.length, "place", "places")}; preserve ${count(preview.preserved.length, "later edit or hidden state", "later edits or hidden states")}.`,
                        )}
                      </>
                    )}
                  </p>
                  {preview.affected.slice(0, previewLimit).map((item) => (
                    <ExperienceBatchItemPreview key={item.id} item={item} />
                  ))}
                  {preview.affected.length > previewLimit && (
                    <button type="button" className={css.link} onClick={() => setPreviewLimit((n) => n + 20)}>
                      {t(
                        `展开更多（剩余 ${preview.affected.length - previewLimit} 段）`,
                        `Show more (${preview.affected.length - previewLimit} remaining)`,
                      )}
                    </button>
                  )}
                  {preview.preserved.slice(0, 20).map((item) => (
                    <p key={item.id} className={css.source}>
                      {t("保留：", "Kept: ")}
                      {item.title} ·{" "}
                      {t(
                        item.reason,
                        (
                          {
                            "已经隐藏，保留当前状态": "Already hidden; kept current state",
                            "无需确认或城市尚未解析，保留当前状态":
                              "No confirmation needed or city unresolved; kept current state",
                            "后续已有修改，保留当前资料": "Edited later; kept current data",
                          } as Record<string, string>
                        )[item.reason] ?? item.reason,
                      )}
                    </p>
                  ))}
                  <div className={css.actions}>
                    <button
                      type="button"
                      className={css.control}
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const result = await props.changeExperienceBatch(
                            preview.id,
                            preview.operation,
                            preview.revision,
                          );
                          return preview.operation === "confirm"
                            ? t(
                                `已确认 ${result.affected} 段经历，保留 ${result.preserved} 段其他资料`,
                                `Confirmed ${count(result.affected, "place", "places")}; preserved ${count(result.preserved, "other place", "other places")}`,
                              )
                            : t(
                                `已${preview.operation === "undo" ? "撤销" : "恢复"} ${result.affected} 段经历，保留 ${result.preserved} 段后续资料`,
                                `${preview.operation === "undo" ? "Undid" : "Restored"} ${count(result.affected, "place", "places")}; preserved ${count(result.preserved, "later record", "later records")}`,
                              );
                        })
                      }
                    >
                      {preview.operation === "confirm"
                        ? t("确认这批经历", "Confirm places")
                        : preview.operation === "undo"
                          ? t("确认撤销导入", "Confirm undo")
                          : t("确认恢复导入", "Confirm restore")}
                    </button>
                    <button
                      type="button"
                      className={css.link}
                      disabled={busy}
                      onClick={() => setPreview(null)}
                    >
                      {t("取消", "Cancel")}
                    </button>
                  </div>
                </section>
              )}
              {data.batches.some((batch) => batch.confirmable > 0) && (
                <>
                  <h3>{t("待核对", "To review")}</h3>
                  {data.batches
                    .filter((batch) => batch.confirmable > 0)
                    .slice(0, limit)
                    .map((batch) => (
                      <article key={batch.id} className={css.reviewItem}>
                        <strong>
                          {batch.sources.map(sourceName).join(t("、", ", "))} ·{" "}
                          {batch.ts.slice(0, 16).replace("T", " ")}
                        </strong>
                        <p className={css.secondary}>
                          {t(
                            `${batch.confirmable} 段经历待确认`,
                            `${count(batch.confirmable, "place", "places")} to confirm`,
                          )}
                        </p>
                        <button
                          type="button"
                          className={css.control}
                          disabled={busy}
                          onClick={() => loadPreview(batch.id, "confirm")}
                        >
                          {t("这批全部确认", "Confirm this batch")}
                        </button>
                      </article>
                    ))}
                  {data.batches.filter((batch) => batch.confirmable > 0).length > limit && (
                    <button type="button" className={css.link} onClick={() => setLimit((n) => n + 10)}>
                      {t("更多待核对批次", "More batches to review")}
                    </button>
                  )}
                </>
              )}
              <h3>{t("资料来源", "Sources")}</h3>
              {!data.sources.length && (
                <p className={css.secondary}>{t("还没有足迹来源。", "No footprint sources yet.")}</p>
              )}
              {data.sources.slice(0, sourceLimit).map((item) => (
                <article
                  key={item.locator}
                  className={css.reviewItem}
                  aria-label={t(`来源 ${sourceName(item.locator)}`, `Source ${sourceName(item.locator)}`)}
                >
                  <p className={css.source}>{sourceName(item.locator)}</p>
                  <p className={css.secondary}>
                    {item.excluded ? t("已排除", "Excluded") : t("已启用", "Enabled")} ·{" "}
                    {t(
                      `${item.active} 段可见 · ${item.hidden} 段隐藏`,
                      `${item.active} visible · ${item.hidden} hidden`,
                    )}
                  </p>
                  <button
                    type="button"
                    className={css.link}
                    disabled={busy}
                    onClick={() => {
                      setPreview(null);
                      setSource(item);
                      setNotice(null);
                    }}
                  >
                    {item.excluded
                      ? t("重新启用来源", "Re-enable source")
                      : t("排除这个来源", "Exclude this source")}
                  </button>
                </article>
              ))}
              {data.sources.length > sourceLimit && (
                <button type="button" className={css.link} onClick={() => setSourceLimit((n) => n + 10)}>
                  {t("更多资料来源", "More sources")}
                </button>
              )}
              <h3>{t("导入记录", "Import history")}</h3>
              {!data.batches.length && (
                <p className={css.secondary}>
                  {t(
                    "还没有可撤销的导入批次。已有经历可单独修正或隐藏。",
                    "No import batches to undo yet. Correct or hide individual places as needed.",
                  )}
                </p>
              )}
              {data.batches.slice(0, limit).map((batch) => (
                <article
                  key={batch.id}
                  className={css.reviewItem}
                  aria-label={t(`导入 ${batch.id}`, `Import ${batch.id}`)}
                >
                  <strong>
                    {batch.ts.slice(0, 16).replace("T", " ")} ·{" "}
                    {t(`${batch.added} 段经历`, `${count(batch.added, "place", "places")}`)}
                  </strong>
                  <p className={css.secondary}>
                    {batch.state === "undone" ? t("已撤销", "Undone") : t("已导入", "Imported")} ·{" "}
                    {t(
                      `${batch.duplicates} 段重复 · ${batch.excluded} 段来源已排除`,
                      `${count(batch.duplicates, "duplicate", "duplicates")} · ${batch.excluded} from excluded sources`,
                    )}
                  </p>
                  <p className={css.source}>{batch.sources.map(sourceName).join(t("、", ", "))}</p>
                  <button
                    type="button"
                    className={css.link}
                    disabled={busy}
                    onClick={() => loadPreview(batch.id, batch.state === "undone" ? "restore" : "undo")}
                  >
                    {batch.state === "undone"
                      ? t("查看恢复范围", "Preview restore")
                      : t("查看撤销范围", "Preview undo")}
                  </button>
                </article>
              ))}
              {data.batches.length > limit && (
                <button type="button" className={css.link} onClick={() => setLimit((n) => n + 10)}>
                  {t("更多导入记录", "More imports")}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </details>
  );
}
