import { KaituError } from "@kaitu/core";
import type { AskEvent, AskService } from "./ask.js";

export function phoneAnswer(ask?: AskService) {
  return async (prompt: string, signal: AbortSignal): Promise<string> => {
    if (!ask || !(await ask.settings()).configured) return "请先在电脑上的开图里连接 AI";
    signal.throwIfAborted();
    const service = ask.background("phone-ask");
    const thread = service.create();
    return new Promise<string>((resolve, reject) => {
      let answer = "";
      const finish = (error?: Error) => {
        clearTimeout(timer);
        unsubscribe();
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else if (answer) resolve(answer);
        else reject(new KaituError("AI 没有返回文本，请重试", "AI_CONNECTION"));
      };
      const abort = () => finish(new KaituError("手机回复已停止", "AI_CONNECTION"));
      const receive = (event: AskEvent) => {
        if (event.type === "assistant/message") {
          const message = event.data.message as { content?: { type: string; text?: string }[] } | undefined;
          const text =
            message?.content
              ?.filter((block) => block.type === "text")
              .map((block) => block.text ?? "")
              .join("") ?? "";
          if (text) answer += `${answer ? "\n\n" : ""}${text}`;
        }
        if (event.type === "session.status" && event.data.status === "idle")
          finish(event.data.error ? new KaituError(String(event.data.error), "AI_CONNECTION") : undefined);
      };
      const unsubscribe = service.subscribe(thread.id, receive);
      const timer = setTimeout(
        () => finish(new KaituError("AI 回复超时，请稍后重试", "AI_CONNECTION")),
        180000,
      );
      signal.addEventListener("abort", abort, { once: true });
      void service.send(thread.id, prompt).catch((error) => finish(error));
    }).finally(() => service.close());
  };
}
