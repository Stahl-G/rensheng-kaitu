import { useCallback, useEffect, useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

export interface PluginItem {
  name: string;
  title: string | { zh?: string; en?: string };
  description: string | { zh?: string; en?: string };
  version: string;
  spec: string;
  installed: boolean;
  installedVersion?: string;
  updateAvailable?: boolean;
  license?: string;
  homepage?: string;
  dshVersion?: string;
  removable?: boolean;
}
export type PluginRequest = (
  action: "list" | "install" | "remove" | "open" | "explore" | "page",
  input?: string,
) => Promise<unknown>;

/** 开图 App 的插件：从开图插件目录安装，页面在 DSH 窗口里打开。 */
export function Plugins({
  request,
  openLabel,
}: {
  request: PluginRequest;
  openLabel?: readonly [string, string];
}) {
  const t = useT();
  const text = (value: PluginItem["title"]) =>
    typeof value === "string" ? value : t(value.zh ?? value.en ?? "", value.en ?? value.zh ?? "");
  const [items, setItems] = useState<PluginItem[] | null>(null);
  const [working, setWorking] = useState("");
  const [operation, setOperation] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [receipt, setReceipt] = useState("");
  const load = useCallback(
    async (refresh = false) => {
      try {
        setItems((await request("list")) as PluginItem[]);
        setError("");
        if (refresh) {
          setRefreshing(true);
          setItems((await request("list", "refresh")) as PluginItem[]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (refresh) setRefreshing(false);
      }
    },
    [request],
  );
  useEffect(() => {
    void load(true);
  }, [load]);
  const run = async (name: string, action: "install" | "remove" | "open", input?: string) => {
    setWorking(name);
    setOperation(action);
    setError("");
    setReceipt("");
    try {
      const result = (await request(action, input)) as { application?: string } | undefined;
      if (result?.application === "restart-required")
        setReceipt(t("重启 DSH 后生效。", "Restart DSH to apply this change."));
      if (action !== "open") {
        window.dispatchEvent(new Event("kaitu:plugins-changed"));
        await load();
      }
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
        <button
          type="button"
          className={css.link}
          disabled={refreshing || !!working}
          onClick={() => void load(true)}
        >
          {refreshing ? t("正在刷新…", "Refreshing…") : t("刷新目录", "Refresh plugins")}
        </button>
        {(openLabel || items?.some((item) => item.installed)) && (
          <button
            type="button"
            className={css.link}
            disabled={!!working}
            onClick={() => void run("open", "open")}
          >
            {openLabel ? t(openLabel[0], openLabel[1]) : t("打开插件页面", "Open plugin pages")}
          </button>
        )}
      </div>
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      {receipt && <output>{receipt}</output>}
      {!items ? (
        !error && <p className={css.small}>{t("正在读取插件目录…", "Loading plugins…")}</p>
      ) : (
        <section className={css.card}>
          <h3>{t("开图插件", "Kaitu plugins")}</h3>
          <div className={css["list-card"]}>
            {items.map((item) => (
              <div className={css["switch-row"]} key={item.name}>
                <span>
                  <b>{text(item.title)}</b>
                  {item.installed && item.installedVersion && (
                    <span className={css.small}>
                      {" "}
                      · {t(`已安装 ${item.installedVersion}`, `Installed ${item.installedVersion}`)}
                    </span>
                  )}
                  {(item.version || item.license || item.dshVersion) && (
                    <>
                      <br />
                      <span className={css.small}>
                        {item.version && t(`目录版本 ${item.version}`, `Catalog version ${item.version}`)}
                        {item.license &&
                          t(` · 目录代码许可 ${item.license}`, ` · Catalog code license ${item.license}`)}
                        {item.dshVersion &&
                          t(` · 声明适配 DSH ${item.dshVersion}`, ` · Declares DSH ${item.dshVersion}`)}
                      </span>
                    </>
                  )}
                  {item.homepage && (
                    <>
                      {" · "}
                      <a href={item.homepage} target="_blank" rel="noreferrer">
                        {t("项目与第三方许可", "Project and third-party licenses")}
                      </a>
                    </>
                  )}
                  {item.description && (
                    <>
                      <br />
                      <span className={css.small}>{text(item.description)}</span>
                    </>
                  )}
                </span>
                <div className={css["plugin-actions"]}>
                  {item.installed && item.updateAvailable && item.spec && (
                    <button
                      type="button"
                      className={`${css.btn} ${css["btn-primary"]}`}
                      disabled={!!working}
                      onClick={() => void run(item.name, "install", item.spec)}
                    >
                      {working === item.name && operation === "install"
                        ? t("正在更新…", "Updating…")
                        : t(`更新至 ${item.version}`, `Update to ${item.version}`)}
                    </button>
                  )}
                  {item.installed && item.removable === false ? (
                    <span className={css.small}>{t("由 DSH 管理", "Managed by DSH")}</span>
                  ) : !item.installed && !item.spec ? (
                    <span className={css.small}>{t("开发中", "In development")}</span>
                  ) : (
                    <button
                      type="button"
                      className={`${css.btn} ${item.installed ? css["btn-quiet"] : css["btn-primary"]}`}
                      disabled={!!working}
                      onClick={() =>
                        void (item.installed
                          ? run(item.name, "remove", item.name)
                          : run(item.name, "install", item.spec))
                      }
                    >
                      {working === item.name && operation === (item.installed ? "remove" : "install")
                        ? item.installed
                          ? t("正在移除…", "Removing…")
                          : t("正在安装…", "Installing…")
                        : item.installed
                          ? t("卸载", "Uninstall")
                          : t("安装", "Install")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
