import { KaituError, type Workspace, readResume, resumePrompt, uploadResume } from "@kaitu/core";
import type { AskService } from "./ask.js";
import { askText } from "./project-ai.js";

/** Reuse the configured Ask connection, with tools refused and no chat history. */
export async function extractResume(ws: Workspace, file: string, parent?: AskService) {
  if (!parent)
    throw new KaituError(
      "请连接问问的 AI，或把提示词交给常用 AI 后贴回结果。 / Connect AI for Ask, or use the copy/paste option.",
      "AI_NOT_CONFIGURED",
    );
  const settings = await parent.settings(true);
  const source = readResume(ws, file);
  if (!settings.configured)
    throw new KaituError("请先连接问问的 AI / Connect AI for Ask first", "AI_NOT_CONFIGURED");
  if (source.mime !== "application/pdf" && !settings.supportsImages)
    throw new KaituError(
      "当前模型不支持图片，请切换可看图的模型，或用外部 AI。 / This model cannot read images. Switch models or use an external AI.",
      "AI_IMAGE",
    );
  const upload =
    source.mime === "application/pdf" ? await uploadResume(ws, source.name, source.data) : source;
  const service = parent.background(undefined, { textOnly: true });
  try {
    const answer = await askText(
      service,
      resumePrompt(upload),
      {
        timeout: "读取简历超时，请重试 / Résumé reading timed out. Retry.",
        empty: "AI 没有返回经历 / The AI returned no experience",
      },
      60000,
      source.mime === "application/pdf"
        ? []
        : [{ data: source.data, mimeType: source.mime as "image/png" | "image/jpeg" | "image/webp" }],
    );
    return { answer, provider: settings.providerName || settings.provider, model: settings.model };
  } finally {
    await service.close().catch(() => {});
  }
}
