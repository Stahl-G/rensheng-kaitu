import { useState } from "react";
import css from "./Prototype.module.css";
import { useT } from "./i18n.js";

/** 展开时把挤在正文里的 [标签] 拆到各自一行，读起来不再是一整段。 */
const splitTags = (text: string) => text.replace(/(?<=.)(?=[[【][^\]】]{1,16}[\]】])/g, "\n");

/**
 * 长文本先截成两行，点一下展开全文；展开后再点收起。
 * 用于旧数据里被塞进整段文字的目标标题等位置，兜底避免铺满一屏。
 */
export function ClampedText({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <button
      type="button"
      className={`${css.clamp} ${className}`}
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <span className={open ? css.clampOpen : css.clampBody}>{open ? splitTags(text) : text}</span>
      <small className={css.clampHint}>
        {open ? t("收起", "Show less") : t("展开全文", "Show full text")}
      </small>
    </button>
  );
}
