import { useState } from "react";
import css from "./AgentHandoff.module.css";
import base from "./Prototype.module.css";
import { useT } from "./i18n.js";

/** 笔记与决策还空着时：告诉用户怎么让自己的 Agent 往里写，每句可直接复制。 */
export function AgentPhrases() {
  const t = useT();
  const [copied, setCopied] = useState(-1);
  const phrases = [
    [
      t("存一篇文章去学", "Save an article to learn"),
      t(
        "把这篇文章存成开图的学习主题：<链接>。按 learn-topic 技能做：读原文存进来源，下一步写一个 15 分钟内能做完的小动作。不要替我写「我的理解」。",
        "Save this article as a Kaitu learning topic: <link>. Follow the learn-topic skill: read it and keep it as a source, and set one next step I can finish in 15 minutes. Do not write “my understanding” for me.",
      ),
    ],
    [
      t("接着学", "Keep learning"),
      t("接着学「<主题>」，一次只问我一个问题。", "Continue “<topic>” with me. Ask one question at a time."),
    ],
    [
      t("做一个决定", "Make a decision"),
      t(
        "按 decision 技能在开图里建一个决定：<要决定的事>。列出选项、标准和还不知道的，先别替我选。",
        "Follow the decision skill and start a decision in Kaitu: <what to decide>. List the options, criteria and unknowns. Do not choose for me yet.",
      ),
    ],
  ];
  return (
    <section className={css.handoff} aria-labelledby="agent-phrases">
      <h3 id="agent-phrases">{t("让你的 Agent 往这里记", "Let your Agent add here")}</h3>
      <p className={css.lead}>
        {t(
          "在开图工作区里开 Claude Code、Codex 或别的 Agent，把下面一句贴过去，换掉尖括号里的内容。也可以直接在问问里说。",
          "Open Claude Code, Codex or another Agent in your Kaitu workspace and paste one of these, replacing the part in angle brackets. You can also say it in Ask.",
        )}
      </p>
      <ol className={css.steps}>
        {phrases.map(([title, text], index) => (
          <li key={title}>
            <div className={css.stepText}>
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
            <div className={css.row}>
              <button
                type="button"
                className={base.btn}
                onClick={() => void navigator.clipboard.writeText(text ?? "").then(() => setCopied(index))}
              >
                {t("复制这句", "Copy")}
              </button>
              {copied === index && <output className={css.done}>{t("已复制", "Copied")}</output>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
