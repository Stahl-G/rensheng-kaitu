import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import css from "./ExploreNavigation.module.css";
import { defaultExploreEntries, exploreModules, moduleIcon } from "./explore-modules.js";
import { useT } from "./i18n.js";

export interface ExploreEntry {
  id: string;
  title: readonly [string, string];
  description: readonly [string, string];
  icon: string;
}

function Entry({
  entry,
  current,
  busy,
  open,
  hide,
  first,
}: {
  entry: ExploreEntry;
  current: string;
  busy: boolean;
  open: () => void;
  hide: () => void;
  first: boolean;
}) {
  const t = useT();
  const title = t(entry.title[0], entry.title[1]);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id, disabled: busy });
  return (
    <div
      ref={setNodeRef}
      className={css.exploreEntry}
      data-dragging={isDragging}
      data-current={current === entry.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button type="button" className={css.exploreOpen} aria-pressed={current === entry.id} onClick={open}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={moduleIcon(entry)} />
        </svg>
        <span>
          <strong>{title}</strong>
          <small>{t(entry.description[0], entry.description[1])}</small>
          {first && <small>{t("打开开图时先到这里", "Opens first")}</small>}
        </span>
      </button>
      <div className={css.exploreEntryActions}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={busy}
          className={css.exploreDrag}
          aria-label={t(`拖动排序：${title}`, `Reorder ${title}`)}
        >
          ⠿
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={hide}
          aria-label={t(`隐藏入口：${title}`, `Hide ${title} entry`)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function ExploreModulesPage({
  entries,
  current,
  open,
  save,
  modules = exploreModules,
  summaries = {},
  empty = false,
}: {
  entries: string[] | null;
  current: string;
  open: (id: string) => void;
  save: (entries: string[]) => Promise<unknown>;
  modules?: readonly ExploreEntry[];
  summaries?: Record<string, string>;
  empty?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const available = new Map(modules.map((entry) => [entry.id as string, entry]));
  const visible = (entries ?? []).flatMap((id) => available.get(id) ?? []);
  const hidden = modules.filter((entry) => !entries?.includes(entry.id));
  const change = async (next: string[]) => {
    setBusy(true);
    setError("");
    try {
      await save(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={css.exploreNavigation}
      aria-busy={busy || entries === null}
      aria-label={t("全部模块", "All modules")}
    >
      <h1>{t("全部模块", "All modules")}</h1>
      <p>
        {empty
          ? t(
              "开图里可以放这些。选一个模块，记下第一条资料。",
              "Here is what you can keep in Kaitu. Choose a module to add your first record.",
            )
          : t(
              "拖动调整顺序。排在第一个的，就是点“开图”时打开的那一页。",
              "Drag to reorder. The first one opens when you click Explore.",
            )}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          screenReaderInstructions: {
            draggable: t(
              "按空格开始移动，方向键调整位置，空格放下，Esc 取消。",
              "Press Space to pick up, arrow keys to move, Space to drop, or Escape to cancel.",
            ),
          },
        }}
        onDragEnd={({ active, over }) => {
          if (entries && over && active.id !== over.id)
            void change(
              arrayMove(entries, entries.indexOf(String(active.id)), entries.indexOf(String(over.id))),
            );
        }}
      >
        <SortableContext items={visible.map((entry) => entry.id)} strategy={rectSortingStrategy}>
          <nav className={css.exploreEntries} aria-label={t("开图里的内容", "Explore sections")}>
            {visible.map((entry) => (
              <Entry
                key={entry.id}
                entry={{
                  ...entry,
                  description: summaries[entry.id]
                    ? [summaries[entry.id] ?? "", summaries[entry.id] ?? ""]
                    : entry.description,
                }}
                current={current}
                busy={busy}
                first={!empty && visible[0]?.id === entry.id}
                open={() => open(entry.id)}
                hide={() => void change((entries ?? []).filter((id) => id !== entry.id))}
              />
            ))}
          </nav>
        </SortableContext>
      </DndContext>
      <div className={css.exploreManage}>
        <button
          type="button"
          disabled={entries === null || busy}
          onClick={() =>
            void change([
              ...defaultExploreEntries,
              ...modules.filter(({ id }) => id.startsWith("plugin:")).map(({ id }) => id),
            ])
          }
        >
          {t("恢复默认布局", "Restore default layout")}
        </button>
      </div>
      {hidden.length > 0 && (
        <section className={css.explorePicker} aria-label={t("还可以添加", "Add more")}>
          <h2>{t("还可以添加", "Add more")}</h2>
          {hidden.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={busy || entries === null}
              onClick={() => void change([...(entries ?? []), entry.id])}
            >
              {t("添加", "Add")} {t(entry.title[0], entry.title[1])}
            </button>
          ))}
          {!hidden.length && <p>{t("所有可用入口都已显示。", "All available entries are shown.")}</p>}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export function ExploreNavigation({
  entries,
  current,
  open,
  modules = exploreModules,
}: {
  entries: string[] | null;
  current: string;
  open: (id: string) => void;
  modules?: readonly ExploreEntry[];
}) {
  const t = useT();
  return (
    <nav className={css.tabs} aria-label={t("开图的模块", "Explore modules")} aria-busy={entries === null}>
      {(entries ?? [])
        .flatMap((id) => modules.find((entry) => entry.id === id) ?? [])
        .map((entry) => (
          <button
            type="button"
            key={entry.id}
            aria-current={current === entry.id ? "page" : undefined}
            onClick={() => open(entry.id)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={moduleIcon(entry)} />
            </svg>
            {t(entry.title[0], entry.title[1])}
          </button>
        ))}
      <button
        type="button"
        aria-current={current === "modules" ? "page" : undefined}
        onClick={() => open("modules")}
        disabled={entries === null}
      >
        <span aria-hidden="true">＋</span>
        {t("全部模块", "All modules")}
      </button>
    </nav>
  );
}
