import {
  KaituError,
  type Locale,
  type OnboardingMatter,
  type Workspace,
  draftOnboardingMatter,
  matterPrompt,
  parseMatterAnswer,
  pick,
  readOnboardingMatter,
  recordOnboardingAiConnection,
} from "@kaitu/core";
import type { AskService } from "./ask.js";

export async function organizeOnboardingMatter(
  ws: Workspace,
  source: string,
  ask?: AskService,
  locale: Locale = "zh-CN",
): Promise<OnboardingMatter> {
  const matter = readOnboardingMatter(ws, source);
  if (!ask || !(await ask.settings()).configured) return matter;
  recordOnboardingAiConnection(ws, "问问");
  const service = ask.background();
  let stop = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const thread = await service.create();
    const response = new Promise<string>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new KaituError("AI 整理超时，原文已保存，可以手工填写或重试", "AI_TIMEOUT")),
        90000,
      );
      stop = service.subscribe(thread.id, (event) => {
        if (event.type === "approval/asked")
          return reject(
            new KaituError(
              pick(
                locale,
                "本机 Agent 需要你批准一次操作，原文已保存，请在问问继续整理",
                "Your local Agent needs approval for an operation. Your text is saved; continue organizing in Ask",
              ),
              "AI_APPROVAL_REQUIRED",
            ),
          );
        if (event.type !== "session.status" || event.data.status !== "idle") return;
        if (event.data.error) return reject(new KaituError(String(event.data.error), "AI_CONNECTION"));
        const messages = service.events(thread.id).filter((item) => item.type === "assistant/message");
        const message = messages.at(-1)?.data.message as
          | { content?: { type: string; text?: string }[] }
          | undefined;
        const text = message?.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("\n");
        if (text) resolve(text);
        else reject(new Error("AI 未返回整理草稿，原文已保存，可以手工填写"));
      });
    });
    const sending = service.send(thread.id, matterPrompt(matter.text, locale, "json"));
    void sending.catch(() => {});
    const text = await Promise.race([response, sending.then(() => response)]);
    let input: ReturnType<typeof parseMatterAnswer>;
    try {
      input = parseMatterAnswer(text, locale);
    } catch {
      throw new Error(
        pick(
          locale,
          "AI 返回的草稿格式无法读取，原文已保存，可以手工填写或重试",
          "Couldn't read the AI's draft. Your text is saved; fill it in yourself or try again",
        ),
      );
    }
    return await draftOnboardingMatter(ws, source, input);
  } finally {
    stop();
    clearTimeout(timer);
    await service.close();
  }
}
