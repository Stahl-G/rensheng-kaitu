import type { SyncProvider } from "@kaitu/core";
import { useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

// GitHub 不是同步盘：资料放在这台电脑，再接上私有仓库同步。
type Choice = SyncProvider | "github";
export const PROVIDERS: {
  id: Choice;
  zh: string;
  en: string;
  key?: "icloud" | "drive" | "nutstore";
}[] = [
  { id: "github", zh: "这台电脑 + 私有 GitHub 仓库", en: "This computer + a private GitHub repo" },
  { id: "local", zh: "仅存这台电脑", en: "This computer only" },
  { id: "icloud", zh: "iCloud 云盘", en: "iCloud Drive", key: "icloud" },
  { id: "google-drive", zh: "Google Drive", en: "Google Drive", key: "drive" },
  { id: "nutstore", zh: "坚果云", en: "Nutstore (坚果云)", key: "nutstore" },
  { id: "folder", zh: "其他同步盘的文件夹", en: "A folder another sync app syncs" },
];

export interface StorageInfo {
  provider?: SyncProvider;
  root: string;
  /** 已接上 GitHub 同步。 */
  github?: boolean;
  suggested?: { icloud: string | null; drive: string | null; nutstore: string | null; home: string };
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
  onDone: (moved: boolean, github: boolean) => Promise<void> | void;
  submitLabel: string;
}) {
  const t = useT();
  const current: Choice =
    storage.github && (storage.provider ?? "local") === "local" ? "github" : (storage.provider ?? "local");
  const suggestion = (id: Choice) => {
    if (id === current) return storage.root;
    if (id === "github" || id === "local")
      return current === "local" || current === "github"
        ? storage.root
        : storage.suggested
          ? `${storage.suggested.home}/kaitu`
          : "";
    const key = PROVIDERS.find((entry) => entry.id === id)?.key;
    const folder = key ? storage.suggested?.[key] : null;
    return folder ? `${folder}/kaitu-ai-memory` : "";
  };
  const [provider, setProvider] = useState<Choice>(current);
  const [path, setPath] = useState(storage.root);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = (next: Choice) => {
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
          const github = provider === "github";
          const target = github ? "local" : provider;
          if (moved) await moveStorage(path.trim(), target !== "local", target);
          await onDone(moved, github);
        });
      }}
    >
      <fieldset className={css.storageProviders}>
        <legend className={css.small}>{t("资料放在", "Keep your notes in")}</legend>
        {PROVIDERS.map((item) => {
          const found = item.key ? Boolean(storage.suggested?.[item.key]) : true;
          return (
            <label key={item.id} className={css.storageOption}>
              <input
                type="radio"
                name="storage-provider"
                checked={provider === item.id}
                disabled={busy}
                onChange={() => choose(item.id)}
              />
              <span className={css.storageLabel}>
                <span>{t(item.zh, item.en)}</span>
                {item.key && (
                  <span className={css.small}>
                    {found ? t("已在这台电脑上找到", "found on this computer") : t("没找到", "not found")}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className={css.small}>
        {t(
          "可以只用 GitHub，不必同时连 Drive。桌面始终读写所选的本地文件夹。",
          "You can use GitHub without Drive. The desktop app always reads and writes the selected local folder.",
        )}
      </p>
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
              const selected = folder.replace(/[\\/]+$/, "");
              const normalized = selected.replaceAll("\\", "/").toLowerCase();
              const detected = PROVIDERS.find((item) => {
                const base = item.key
                  ? storage.suggested?.[item.key]?.replaceAll("\\", "/").toLowerCase()
                  : undefined;
                return base && (normalized === base || normalized.startsWith(`${base}/`));
              });
              const target = detected?.id ?? provider;
              const name = "kaitu-ai-memory";
              const leaf = selected.split(/[\\/]/).at(-1)?.toLowerCase();
              setPath(
                selected === storage.root || leaf === "kaitu" || leaf === "kaitu-ai-memory"
                  ? selected
                  : `${selected}${separator}${name}`,
              );
              if (detected) setProvider(detected.id);
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
