import { createContext, useContext, useEffect, useRef, useState } from "react";
import filesCss from "./DshFiles.module.css";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export interface FileCandidate {
  path: string;
  kind: "file" | "directory";
}
export interface FileServices {
  pickDirectory(): Promise<string | null>;
  findFiles(query: string): Promise<FileCandidate[]>;
  openPath(path: string, action: "open" | "reveal"): Promise<unknown>;
}
async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`/api/product/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kaitu": "1" },
    body: JSON.stringify(args),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "资料操作未完成");
  return result;
}
export const FileServicesContext = createContext<FileServices>({
  pickDirectory: () => call("pickStorageFolder"),
  findFiles: (query) => call("findWorkspaceFiles", query),
  openPath: (path, action) => call("openWorkspacePath", path, action),
});

export function FolderButton({
  onSelect,
  disabled = false,
}: { onSelect(path: string): void; disabled?: boolean }) {
  const t = useT();
  const services = useContext(FileServicesContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className={`${css.btn} ${css["btn-quiet"]}`}
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const path = await services.pickDirectory();
            if (path) onSelect(path);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t("正在选择…", "Choosing…") : t("选择文件夹…", "Choose folder…")}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function FilePicker({
  select,
  close,
  query: givenQuery,
  filesOnly = false,
}: {
  select(path: string, kind?: "file" | "directory"): void;
  close(): void;
  query?: string;
  filesOnly?: boolean;
}) {
  const t = useT();
  const services = useContext(FileServicesContext);
  const [typedQuery, setQuery] = useState("");
  const query = givenQuery ?? typedQuery;
  const [items, setItems] = useState<FileCandidate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => search.current?.focus(), []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void services
        .findFiles(query)
        .then((rows) => {
          if (active) {
            setItems(rows);
            setError("");
          }
        })
        .catch((err) => {
          if (active) setError(err.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, services]);
  return (
    <section
      className={filesCss.picker}
      aria-label={t("选择开图资料", "Choose Kaitu files")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          close();
        }
      }}
    >
      <header className={filesCss.header}>
        <span>{t("开图资料", "Kaitu files")}</span>
        <button type="button" onClick={close} aria-label={t("关闭资料选择", "Close file picker")}>
          ×
        </button>
      </header>
      {givenQuery === undefined && (
        <label className={filesCss.search}>
          <span className={filesCss.srOnly}>{t("查找资料", "Find files")}</span>
          <input
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("文件名或文件夹", "File or folder name")}
          />
        </label>
      )}
      {loading && <output className={filesCss.notice}>{t("正在查找…", "Searching…")}</output>}
      {error && (
        <p className={filesCss.notice} role="alert">
          {error}
        </p>
      )}
      {!loading && !error && !items.length && (
        <p className={filesCss.notice}>{t("没有找到资料", "No matching files")}</p>
      )}
      <div className={filesCss.list}>
        {items.map((item) => (
          <button
            type="button"
            className={filesCss.row}
            key={item.path}
            onClick={() =>
              filesOnly && item.kind === "directory"
                ? setQuery(`${item.path}/`)
                : select(item.path, item.kind)
            }
          >
            <span className={filesCss.kind}>
              {item.kind === "directory" ? t("文件夹", "Folder") : t("文件", "File")}
            </span>
            <span className={filesCss.path} title={item.path}>
              {item.path}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function OpenPath({ path }: { path: string }) {
  const t = useT();
  const services = useContext(FileServicesContext);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = async (action: "open" | "reveal") => {
    setBusy(true);
    setError("");
    try {
      await services.openPath(path, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span>
      <button type="button" className={css.link} disabled={busy} onClick={() => void open("open")}>
        {path}
      </button>
      {" · "}
      <button type="button" className={css.link} disabled={busy} onClick={() => void open("reveal")}>
        {t("显示位置", "Reveal")}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
