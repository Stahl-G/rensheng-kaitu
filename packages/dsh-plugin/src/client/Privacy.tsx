import css from "./Prototype.module.css";
import { useLocale, useT } from "./i18n.js";
import en from "./privacy.en.md";
import zh from "./privacy.zh-CN.md";

type Block = { kind: "h1" | "h2" | "p"; text: string } | { kind: "ul"; items: string[] };

/** 隐私说明正文就是同目录的 Markdown 文件，改说明只改文件；这里只认标题、段落和列表。 */
function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const last = out.at(-1);
    if (text.startsWith("- ")) {
      if (last?.kind === "ul") last.items.push(text.slice(2));
      else out.push({ kind: "ul", items: [text.slice(2)] });
    } else if (text.startsWith("## ")) out.push({ kind: "h2", text: text.slice(3) });
    else if (text.startsWith("# ")) out.push({ kind: "h1", text: text.slice(2) });
    else out.push({ kind: "p", text });
  }
  return out;
}

export function PrivacyPage({ back }: { back: () => void }) {
  const t = useT();
  const locale = useLocale();
  return (
    <article className={`${css.sec} ${css.privacy}`}>
      <button type="button" className={css.link} onClick={back}>
        {t("← 设置", "← Settings")}
      </button>
      {blocks(locale === "en" ? en : zh).map((block, index) =>
        block.kind === "ul" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 说明文件是静态内容，顺序就是身份。
          <ul key={index}>
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : block.kind === "h1" ? (
          <h1 key={block.text}>{block.text}</h1>
        ) : block.kind === "h2" ? (
          <h2 key={block.text}>{block.text}</h2>
        ) : (
          <p key={block.text}>{block.text}</p>
        ),
      )}
    </article>
  );
}
