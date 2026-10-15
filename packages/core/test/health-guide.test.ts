import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("安装页可复制的完整代码与健康收件箱源文件一致", () => {
  const source = readFileSync(
    new URL("../../../integrations/google-apps-script/health-inbox.gs", import.meta.url),
    "utf8",
  );
  const guide = readFileSync(new URL("../../../docs/guides/apple-health.html", import.meta.url), "utf8");
  const embedded = guide.match(
    /<!-- gs:start -->\s*<textarea\b[^>]*>([\s\S]*?)<\/textarea>\s*<!-- gs:end -->/,
  )?.[1];
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
  const decoded = embedded?.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => entities[entity]);
  expect(decoded).toBe(source);
});
