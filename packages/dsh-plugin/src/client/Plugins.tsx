import { useCallback, useEffect, useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export interface PluginItem {
  name: string;
  title: string;
  description: string;
  version: string;
  spec: string;
  installed: boolean;
}
export type PluginRequest = (
  action: "list" | "install" | "remove" | "open",
  input?: string,
) => Promise<unknown>;

/** 开图 App 的插件：从开图插件目录安装，页面在 DSH 窗口里打开。 */
export function Plugins({ request }: { request: PluginRequest }) {
  const t = useT();
  const [items, setItems] = useState<PluginItem[] | null>(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setItems((await request("list")) as PluginItem[]);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = async (name: string, action: "install" | "remove" | "open", input?: string) => {
    setWorking(name);
    setError("");
    try {
      await request(action, input);
      if (action !== "open") await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking("");
    }
  };
  return (
    <section className={css.sec}>
      <div className={css["sec-head"]}>
        <h2 className={css.eyebrow}>{t("插件", "Plugins")}</h2>
        {items?.some((item) => item.installed) && (
          <button
            type="button"
            className={css.link}
            disabled={!!working}
            onClick={() => void run("open", "open")}
          >
            {t("打开插件页面", "Open plugin pages")}
          </button>
        )}
      </div>
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      {!items ? (
        !error && <p className={css.small}>{t("正在读取插件目录…", "Loading plugins…")}</p>
      ) : (
        <div className={`${css.card} ${css["list-card"]}`}>
          {items.map((item) => (
            <div className={css["switch-row"]} key={item.name}>
              <span>
                <b>{item.title}</b>
                {item.version && <span className={css.small}> · {item.version}</span>}
                {item.description && (
                  <>
                    <br />
                    <span className={css.small}>{item.description}</span>
                  </>
                )}
              </span>
              <button
                type="button"
                className={`${css.btn} ${item.installed ? css["btn-quiet"] : css["btn-primary"]}`}
                disabled={!!working || (!item.installed && !item.spec)}
                onClick={() =>
                  void (item.installed
                    ? run(item.name, "remove", item.name)
                    : run(item.name, "install", item.spec))
                }
              >
                {working === item.name
                  ? item.installed
                    ? t("正在移除…", "Removing…")
                    : t("正在安装…", "Installing…")
                  : item.installed
                    ? t("移除", "Remove")
                    : t("安装", "Install")}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
