import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(
  new URL("../integrations/google-apps-script/health-inbox.gs", import.meta.url),
  "utf8",
);
const guidePath = new URL("../docs/guides/apple-health.html", import.meta.url);
const guide = readFileSync(guidePath, "utf8");
const marker = /<!-- gs:start -->[\s\S]*?<!-- gs:end -->/;
if (!marker.test(guide)) throw new Error("安装页缺少 gs:start / gs:end 标记");
const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escaped = source.replace(/[&<>"']/g, (character) => entities[character]);
const embedded = `<textarea id="gs-code" readonly spellcheck="false" aria-label="健康收件箱完整代码">${escaped}</textarea>`;
writeFileSync(
  guidePath,
  guide.replace(marker, () => `<!-- gs:start -->\n${embedded}\n<!-- gs:end -->`),
);
