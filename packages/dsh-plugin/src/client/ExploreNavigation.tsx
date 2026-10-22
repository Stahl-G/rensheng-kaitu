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
import css from "./Prototype.module.css";
import type { ExploreModule } from "./explore-modules.js";
import { useT } from "./i18n.js";

function Entry({
  entry,
  current,
  busy,
  open,
  hide,
}: {
  entry: ExploreModule;
  current: string;
  busy: boolean;
  open: () => void;
  hide: () => void;
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
        {entry.page ? (
          <span aria-hidden="true">{entry.icon}</span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={entry.icon} />
          </svg>
        )}
        <span>
          <strong>{title}</strong>
          <small>{t(entry.description[0], entry.description[1])}</small>
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

export function ExploreNavigation({
  modules,
  entries,
  current,
  open,
  save,
}: {
  modules: readonly ExploreModule[];
  entries: string[] | null;
  current: string;
  open: (id: string) => void;
  save: (entries: string[]) => Promise<unknown>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
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
    <div className={css.exploreNavigation} aria-busy={busy || entries === null}>
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
                entry={entry}
                current={current}
                busy={busy}
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
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t("添加模块", "Add modules")}
        </button>
        <button
          type="button"
          disabled={entries === null || busy}
          onClick={() => void change(modules.map(({ id }) => id))}
        >
          {t("恢复默认布局", "Restore default layout")}
        </button>
      </div>
      {expanded && (
        <section className={css.explorePicker} aria-label={t("添加模块", "Add modules")}>
          {hidden.map((entry) => (
            <button
              key={entry.id}
              type="button"
              disabled={busy}
              onClick={() => void change([...(entries ?? []), entry.id])}
            >
              {t("添加", "Add")} {t(entry.title[0], entry.title[1])}
            </button>
          ))}
          {!hidden.length && <p>{t("所有可用入口都已显示。", "All available entries are shown.")}</p>}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
