import type { SyncProvider } from "@kaitu/core";
import { useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export const PROVIDERS: {
  id: SyncProvider;
  zh: string;
  en: string;
  key?: "icloud" | "drive" | "nutstore";
}[] = [
  { id: "local", zh: "这台电脑（不同步）", en: "This computer (no sync)" },
  { id: "icloud", zh: "iCloud 云盘", en: "iCloud Drive", key: "icloud" },
  { id: "google-drive", zh: "Google Drive", en: "Google Drive", key: "drive" },
  { id: "nutstore", zh: "坚果云", en: "Nutstore (坚果云)", key: "nutstore" },
  { id: "folder", zh: "其他同步盘的文件夹", en: "A folder another sync app syncs" },
];

export interface StorageInfo {
  provider?: SyncProvider;
  root: string;
  suggested?: { icloud: string | null; drive: string | null; nutstore: string | null };
}

/** 选资料放哪：本机或某个云盘。引导第一步和设置里的「换一个存放位置」共用。 */
export function StorageChoice({
  storage,
  moveStorage,
  pickStorageFolder,
  onDone,
  submitLabel,
}: {
  storage: StorageInfo;
  moveStorage: (path: string, drive: boolean, provider?: SyncProvider) => Promise<unknown>;
  pickStorageFolder: () => Promise<string | null>;
  onDone: (moved: boolean) => Promise<void> | void;
  submitLabel: string;
}) {
  const t = useT();
  const current = storage.provider ?? "local";
  const suggestion = (id: SyncProvider) => {
    const key = PROVIDERS.find((entry) => entry.id === id)?.key;
    const folder = key ? storage.suggested?.[key] : null;
    return folder ? `${folder}/kaitu` : id === current ? storage.root : "";
  };
  const [provider, setProvider] = useState<SyncProvider>(current);
  const [path, setPath] = useState(storage.root);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = (next: SyncProvider) => {
    setProvider(next);
    if (!path.trim() || PROVIDERS.some((item) => suggestion(item.id) === path) || path === storage.root)
      setPath(suggestion(next));
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={`${css.card} ${css["sub-form"]}`}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const moved = path.trim() !== storage.root;
          if (moved) await moveStorage(path.trim(), provider !== "local", provider);
          await onDone(moved);
        });
      }}
    >
      <fieldset className={css.stack}>
        <legend className={css.small}>{t("资料放在", "Keep your notes in")}</legend>
        {PROVIDERS.map((item) => {
          const found = item.key ? Boolean(storage.suggested?.[item.key]) : true;
          return (
            <label key={item.id}>
              <input
                type="radio"
                name="storage-provider"
                checked={provider === item.id}
                disabled={busy}
                onChange={() => choose(item.id)}
              />{" "}
              {t(item.zh, item.en)}
              {item.key && (
                <span className={css.small}>
                  {" · "}
                  {found ? t("已在这台电脑上找到", "found on this computer") : t("没找到", "not found")}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>
      <label>
        {t("文件夹位置", "Folder")}
        <input
          required
          value={path}
          disabled={busy}
          placeholder={t("填写文件夹的完整路径", "Full path of the folder")}
          onChange={(event) => setPath(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={`${css.btn} ${css["btn-quiet"]}`}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const folder = await pickStorageFolder();
            if (folder) {
              const separator = folder.includes("\\") ? "\\" : "/";
              setPath(`${folder.replace(/[\\/]+$/, "")}${separator}kaitu`);
            }
          })
        }
      >
        {t("选择文件夹…", "Choose folder…")}
      </button>
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={`${css.btn} ${css["btn-primary"]}`} disabled={busy || !path.trim()}>
        {busy ? t("处理中…", "Working…") : submitLabel}
      </button>
    </form>
  );
}
