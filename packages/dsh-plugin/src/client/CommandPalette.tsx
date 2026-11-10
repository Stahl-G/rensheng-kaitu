import { useEffect, useId, useRef, useState } from "react";
import styles from "./CommandPalette.module.css";
import { useT } from "./i18n.js";
export interface KaituCommand {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  icon?: string;
  run: () => void;
}
export function CommandPalette({
  actions,
  load,
  close,
}: { actions: KaituCommand[]; load: () => Promise<KaituCommand[]>; close: () => void }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<KaituCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    dialog.current?.showModal?.();
    input.current?.focus();
    let live = true;
    void loadRef
      .current()
      .then((items) => {
        if (live) setItems(items);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      if (origin?.isConnected) origin.focus();
    };
  }, []);
  const needle = query.trim().toLocaleLowerCase();
  const results = [...actions, ...items]
    .filter((item) => `${item.label} ${item.detail ?? ""}`.toLocaleLowerCase().includes(needle))
    .slice(0, 60);
  const active = Math.min(selected, Math.max(0, results.length - 1));
  const activate = (item: KaituCommand) => {
    close();
    item.run();
  };
  return (
    <dialog
      ref={dialog}
      className={styles.palette}
      aria-label={t("搜索或输入动作", "Search or enter an action")}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
          const key = event.key.toLowerCase();
          const action = actions.find(
            (item) =>
              item.id === (key === "n" ? "capture" : key === "j" ? "ask" : key === "enter" ? "complete" : ""),
          );
          if (action) {
            event.preventDefault();
            activate(action);
            return;
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSelected(
            (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length),
          );
        }
        if (event.key === "Enter" && results[active]) {
          event.preventDefault();
          activate(results[active]);
        }
      }}
    >
      <div className={styles.search}>
        <span aria-hidden="true">⌕</span>
        <input
          ref={input}
          aria-label={t("搜索或输入动作", "Search or enter an action")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-results`}
          aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          placeholder={t("搜索或输入动作", "Search or enter an action")}
        />
        <button type="button" onClick={close} aria-label={t("关闭", "Close")}>
          esc
        </button>
      </div>
      <div
        tabIndex={-1}
        className={styles.results}
        id={`${id}-results`}
        // biome-ignore lint/a11y/useSemanticElements: Rich action combobox uses virtual focus.
        role="listbox"
        aria-label={t("动作与资料", "Actions and records")}
      >
        {results.slice(0, 60).map((item, index) => (
          <button
            key={item.id}
            id={`${id}-${index}`}
            type="button"
            // biome-ignore lint/a11y/useSemanticElements: Native command buttons inside virtual-focus listbox.
            role="option"
            aria-selected={index === active}
            onMouseMove={() => setSelected(index)}
            onClick={() => activate(item)}
          >
            <span className={styles.icon} aria-hidden="true">
              {item.icon ?? "↗"}
            </span>
            <span>{item.label}</span>
            <small>{item.shortcut ?? item.detail}</small>
          </button>
        ))}
        {!results.length && <p>{loading ? t("正在查找…", "Searching…") : t("没有匹配项", "No matches")}</p>}
      </div>
      {error && <p role="alert">{error}</p>}
    </dialog>
  );
}
