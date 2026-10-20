import { useCallback, useEffect, useRef, useState } from "react";
import type { ExperienceBatchPreview, ExperienceImportsData } from "../types.js";
import css from "./MapPage.module.css";
import { useT } from "./i18n.js";

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
      <summary>来源与导入</summary>
      {open && (
        <section aria-label="足迹来源与导入" aria-busy={busy}>
          {error && (
            <p className={css.notice} role="alert">
              {error}{" "}
              <button type="button" className={css.link} disabled={busy} onClick={() => void refresh()}>
                重新读取
              </button>
            </p>
          )}
          {notice && <output className={css.notice}>{notice}</output>}
          {!data ? (
            <p className={css.secondary}>正在读取来源…</p>
          ) : (
            <>
              {data.pending.length > 0 && (
                <div className={css.reviewItem}>
                  <strong>{data.pending.length} 次导入操作尚未完成</strong>
                  <p className={css.secondary}>继续时只补完未写入的部分，已保存的经历不会重复添加。</p>
                  <button
                    type="button"
                    className={css.control}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await props.recoverExperienceImports();
                        return `已完成 ${result.recovered} 次导入操作`;
                      })
                    }
                  >
                    继续完成导入
                  </button>
                </div>
              )}
              {source && (
                <section ref={confirmation} tabIndex={-1} className={css.notice} aria-label="来源变更确认">
                  <strong>{source.excluded ? "重新启用来源" : "排除来源"}</strong>
                  <p className={css.source}>{sourceName(source.locator)}</p>
                  <p>
                    {source.excluded
                      ? "允许从这份资料新增足迹。已隐藏或已撤销的经历仍保留当前状态。"
                      : `停止从这份资料新增足迹，包括其他原文定位行。已有 ${source.active} 段经历保留。`}
                  </p>
                  <div className={css.actions}>
                    <button
                      type="button"
                      className={css.control}
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await props.setExperienceSource(source.locator, !source.excluded, source.revision);
                          return source.excluded ? "来源已重新启用" : "来源已排除，已有经历保留";
                        })
                      }
                    >
                      {source.excluded ? "确认启用" : "确认排除来源"}
                    </button>
                    <button
                      type="button"
                      className={css.link}
                      disabled={busy}
                      onClick={() => setSource(null)}
                    >
                      取消
                    </button>
                  </div>
                </section>
              )}
              {preview && (
                <section ref={confirmation} tabIndex={-1} className={css.notice} aria-label="导入影响预览">
                  <strong>
                    {preview.operation === "confirm"
                      ? t("这批全部确认", "Confirm this batch")
                      : preview.operation === "undo"
                        ? "撤销这次导入"
                        : "恢复这次导入"}
                  </strong>
                  <p>
                    {preview.operation === "confirm" ? (
                      t(
                        `将确认 ${preview.affected.length} 段经历，保留 ${preview.preserved.length} 段已修改、隐藏、无需确认或城市未解析的资料。`,
                        `Confirm ${preview.affected.length} experiences; preserve ${preview.preserved.length} edited, hidden, unresolved or other experiences.`,
                      )
                    ) : (
                      <>
                        {preview.operation === "undo" ? "将隐藏" : "将恢复"} {preview.affected.length}{" "}
                        段经历，保留 {preview.preserved.length} 段后续已修改的资料或隐藏状态。
                      </>
                    )}
                  </p>
                  {preview.affected.slice(0, 20).map((item) => (
                    <p key={item.id} className={css.source}>
                      {item.title} · {sourceName(item.source)}
                    </p>
                  ))}
                  {preview.affected.length > 20 && (
                    <p className={css.secondary}>另有 {preview.affected.length - 20} 段同批经历</p>
                  )}
                  {preview.preserved.slice(0, 20).map((item) => (
                    <p key={item.id} className={css.source}>
                      保留：{item.title} · {item.reason}
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
                                `Confirmed ${result.affected} experiences; preserved ${result.preserved} others`,
                              )
                            : `已${preview.operation === "undo" ? "撤销" : "恢复"} ${result.affected} 段经历，保留 ${result.preserved} 段后续资料`;
                        })
                      }
                    >
                      {preview.operation === "confirm"
                        ? t("确认这批经历", "Confirm experiences")
                        : preview.operation === "undo"
                          ? "确认撤销导入"
                          : "确认恢复导入"}
                    </button>
                    <button
                      type="button"
                      className={css.link}
                      disabled={busy}
                      onClick={() => setPreview(null)}
                    >
                      取消
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
                          {batch.sources.map(sourceName).join("、")} ·{" "}
                          {batch.ts.slice(0, 16).replace("T", " ")}
                        </strong>
                        <p className={css.secondary}>
                          {t(
                            `${batch.confirmable} 段经历待确认`,
                            `${batch.confirmable} experiences to confirm`,
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
              <h3>资料来源</h3>
              {!data.sources.length && <p className={css.secondary}>还没有足迹来源。</p>}
              {data.sources.slice(0, sourceLimit).map((item) => (
                <article
                  key={item.locator}
                  className={css.reviewItem}
                  aria-label={`来源 ${sourceName(item.locator)}`}
                >
                  <p className={css.source}>{sourceName(item.locator)}</p>
                  <p className={css.secondary}>
                    {item.excluded ? "已排除" : "已启用"} · {item.active} 段可见 · {item.hidden} 段隐藏
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
                    {item.excluded ? "重新启用来源" : "排除这个来源"}
                  </button>
                </article>
              ))}
              {data.sources.length > sourceLimit && (
                <button type="button" className={css.link} onClick={() => setSourceLimit((n) => n + 10)}>
                  更多资料来源
                </button>
              )}
              <h3>导入记录</h3>
              {!data.batches.length && (
                <p className={css.secondary}>还没有可撤销的导入批次。已有经历可单独修正或隐藏。</p>
              )}
              {data.batches.slice(0, limit).map((batch) => (
                <article key={batch.id} className={css.reviewItem} aria-label={`导入 ${batch.id}`}>
                  <strong>
                    {batch.ts.slice(0, 16).replace("T", " ")} · {batch.added} 段经历
                  </strong>
                  <p className={css.secondary}>
                    {batch.state === "undone" ? "已撤销" : "已导入"} · {batch.duplicates} 段重复 ·{" "}
                    {batch.excluded} 段来源已排除
                  </p>
                  <p className={css.source}>{batch.sources.map(sourceName).join("、")}</p>
                  <button
                    type="button"
                    className={css.link}
                    disabled={busy}
                    onClick={() => loadPreview(batch.id, batch.state === "undone" ? "restore" : "undo")}
                  >
                    {batch.state === "undone" ? "查看恢复范围" : "查看撤销范围"}
                  </button>
                </article>
              ))}
              {data.batches.length > limit && (
                <button type="button" className={css.link} onClick={() => setLimit((n) => n + 10)}>
                  更多导入记录
                </button>
              )}
            </>
          )}
        </section>
      )}
    </details>
  );
}
