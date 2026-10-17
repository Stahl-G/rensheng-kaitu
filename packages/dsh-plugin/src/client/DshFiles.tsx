import { createContext, useContext, useEffect, useRef, useState } from "react";
import filesCss from "./DshFiles.module.css";
import css from "./Prototype.module.css";

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
        {busy ? "正在选择…" : "选择文件夹…"}
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
    <section className={filesCss.picker} aria-label="选择开图资料">
      <header className={filesCss.header}>
        <span>开图资料</span>
        <button type="button" onClick={close} aria-label="关闭资料选择">
          ×
        </button>
      </header>
      {givenQuery === undefined && (
        <label className={filesCss.search}>
          <span className={filesCss.srOnly}>查找资料</span>
          <input
            ref={search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="文件名或文件夹"
          />
        </label>
      )}
      {loading && <output className={filesCss.notice}>正在查找…</output>}
      {error && (
        <p className={filesCss.notice} role="alert">
          {error}
        </p>
      )}
      {!loading && !error && !items.length && <p className={filesCss.notice}>没有找到资料</p>}
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
            <span className={filesCss.kind}>{item.kind === "directory" ? "文件夹" : "文件"}</span>
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
        显示位置
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
