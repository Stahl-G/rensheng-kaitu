import { useEffect, useState } from "react";
import type { ProjectDetailData } from "../types.js";
import css from "./AgentHandoff.module.css";
import own from "./ArchitectureCard.module.css";
import base from "./Prototype.module.css";
import { useLocale, useT } from "./i18n.js";

// Archify 的图自带脚本（缩放、主题、导出），只许内联脚本运行。策略不靠在导入内容里找 <head>：
// 外层文档由开图生成，第一行就是策略，内层继承它；外层的 frame-src 'none' 挡住内层自己跳到外网。
// 两层都只给 allow-scripts：不能提交表单、弹窗、跳转父页面，也读不到开图页面。
const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";
const META = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;
const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
const isolate = (html: string) =>
  `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}; frame-src 'none'"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style><iframe sandbox="allow-scripts" srcdoc="${attribute(`<!doctype html>${META}${html}`)}"></iframe>`;

/** 项目页的架构图：显示 Agent 用 Archify 画好交回的图；画图和重画都交给在代码仓库里工作的 Agent。 */
export function ArchitectureCard({
  project,
  prompt,
  load,
}: {
  project: ProjectDetailData;
  prompt: (slug: string, locale: string) => Promise<string>;
  load: (slug: string) => Promise<string | null>;
}) {
  const t = useT();
  const locale = useLocale();
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setHtml(null);
    if (project.architecture)
      void load(project.slug)
        .then((value) => {
          if (active) setHtml(value);
        })
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : String(err));
        });
    return () => {
      active = false;
    };
  }, [project.slug, project.architecture, load]);
  const copy = async () => {
    setBusy(true);
    setError("");
    try {
      await navigator.clipboard.writeText(await prompt(project.slug, locale));
      setCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={css.handoff} aria-labelledby={`architecture-${project.slug}`}>
      <h3 id={`architecture-${project.slug}`}>{t("架构图", "Architecture")}</h3>
      {project.architecture ? (
        <>
          {html ? (
            <iframe
              className={own.frame}
              title={t(`${project.title} 架构图`, `${project.title} architecture`)}
              sandbox="allow-scripts"
              srcDoc={isolate(html)}
            />
          ) : (
            <p className={own.meta}>{t("正在读取…", "Loading…")}</p>
          )}
          <p className={own.meta}>
            {t(
              `Archify 绘制，${new Date(project.architecture).toLocaleDateString(locale)} 交回。日报发现结构有大变化时会建议重画。`,
              `Drawn with Archify, handed back ${new Date(project.architecture).toLocaleDateString(locale)}. The daily review suggests a redraw when the structure changes a lot.`,
            )}
          </p>
        </>
      ) : (
        <p className={css.lead}>
          {t(
            "让在代码仓库里工作的编程 Agent 用 Archify 读代码画一张，画好会显示在这里。",
            "Have a coding Agent working in the repository read the code and draw one with Archify. It appears here when done.",
          )}
        </p>
      )}
      <div className={css.row}>
        <button
          type="button"
          className={project.architecture ? base.btn : `${base.btn} ${base["btn-primary"]}`}
          disabled={busy}
          onClick={() => void copy()}
        >
          {busy
            ? t("正在准备…", "Preparing…")
            : project.architecture
              ? t("用 Archify 重画", "Redraw with Archify")
              : t("用 Archify 画架构图", "Draw with Archify")}
        </button>
        {copied && (
          <output className={css.done}>
            {t(
              "已复制，贴给在这个仓库里工作的 Agent",
              "Copied. Paste it into the Agent working in this repository",
            )}
          </output>
        )}
      </div>
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
