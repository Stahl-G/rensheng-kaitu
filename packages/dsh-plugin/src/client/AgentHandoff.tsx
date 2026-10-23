import { useState } from "react";
import type { ProjectDetailData } from "../types.js";
import css from "./AgentHandoff.module.css";
import base from "./Prototype.module.css";
import { useLocale, useT } from "./i18n.js";

/** 项目页的「交给 Agent 接着做」：把开图项目记忆装进代码仓库，或复制接力提示词。 */
export function AgentHandoff({
  project,
  prompt,
  install,
}: {
  project: ProjectDetailData;
  prompt: (slug: string, locale: string) => Promise<string>;
  install: (slug: string, directory: string) => Promise<{ files: string[] }>;
}) {
  const t = useT();
  const locale = useLocale();
  const linked = project.links.find((link) => link.role === "repo")?.path ?? "";
  const [directory, setDirectory] = useState(linked);
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"install" | "copy" | null>(null);
  const [error, setError] = useState("");
  const bound = !!project.github || !!linked;
  const load = async () => {
    if (text) return text;
    const value = await prompt(project.slug, locale);
    setText(value);
    return value;
  };
  const run = async (kind: "install" | "copy", action: () => Promise<void>) => {
    setBusy(kind);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={css.handoff} aria-labelledby={`handoff-${project.slug}`}>
      <h3 id={`handoff-${project.slug}`}>{t("交给 Agent 接着做", "Hand off to an Agent")}</h3>
      <p className={css.lead}>
        {t(
          "让 Claude Code、Codex 这类编程 Agent 开工前先读这个项目的进度，做完把改动、卡点和下一步记回这里。",
          "Let a coding Agent such as Claude Code or Codex read where this project stands before it starts, then log changes, blockers and next steps back here.",
        )}
      </p>
      <ol className={css.steps}>
        <li>
          <div className={css.stepText}>
            <strong>{t("装到代码仓库", "Add to the code repository")}</strong>
            <span>
              {bound
                ? t(
                    "Agent 在这个仓库里工作时会自动看到。只写 .agents/skills 和 .claude/skills，已有同名技能不会被覆盖。",
                    "Agents working in this repository will pick it up. Only .agents/skills and .claude/skills are written; an existing skill with the same name is left as is.",
                  )
                : t(
                    "先在上面绑定这个项目的 GitHub 仓库，开图才能认出是哪个代码仓库。",
                    "Link this project's GitHub repository above first so Kaitu can recognize the code repository.",
                  )}
            </span>
          </div>
          <form
            className={css.row}
            onSubmit={(event) => {
              event.preventDefault();
              void run("install", async () => {
                const result = await install(project.slug, directory.trim());
                setInstalled(result.files);
              });
            }}
          >
            <input
              aria-label={t("代码仓库的完整路径", "Full path of the code repository")}
              placeholder={t("代码仓库的完整路径", "Full path of the code repository")}
              value={directory}
              disabled={!bound || busy !== null}
              onChange={(event) => {
                setDirectory(event.target.value);
                setInstalled(null);
              }}
            />
            <button
              type="submit"
              className={`${base.btn} ${base["btn-primary"]}`}
              disabled={!bound || !directory.trim() || busy !== null}
            >
              {busy === "install" ? t("正在装…", "Adding…") : t("装上", "Add")}
            </button>
          </form>
          {installed && (
            <output className={css.done}>
              {t(`已装好，写入 ${installed.length} 个文件`, `Added. ${installed.length} files written`)}
            </output>
          )}
        </li>
        <li>
          <div className={css.stepText}>
            <strong>{t("把接力提示词交给 Agent", "Give the hand-off prompt to an Agent")}</strong>
            <span>
              {t(
                "没装技能也能用：贴给任何编程 Agent，它会先读进度，做完记回日志。同样要先绑定仓库。",
                "Works without the skill too: paste it into any coding Agent. It reads the progress first and logs back when done. Link the repository first.",
              )}
            </span>
          </div>
          <div className={css.row}>
            <button
              type="button"
              className={base.btn}
              disabled={!bound || busy !== null}
              onClick={() =>
                void run("copy", async () => {
                  await navigator.clipboard.writeText(await load());
                  setCopied(true);
                })
              }
            >
              {busy === "copy" ? t("正在准备…", "Preparing…") : t("复制提示词", "Copy prompt")}
            </button>
            {copied && (
              <output className={css.done}>
                {t("已复制，贴给你的 Agent", "Copied. Paste it into your Agent")}
              </output>
            )}
          </div>
          <details
            hidden={!bound}
            className={css.preview}
            onToggle={(event) => {
              if (event.currentTarget.open) void run("copy", async () => void (await load()));
            }}
          >
            <summary>{t("看一眼提示词", "Preview the prompt")}</summary>
            {text && <pre>{text}</pre>}
          </details>
        </li>
      </ol>
      {error && (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <p className={css.note}>
        {t(
          "Agent 写回的记录会出现在「最近日志」里。",
          "What the Agent logs back appears under Recent progress.",
        )}
      </p>
    </section>
  );
}
