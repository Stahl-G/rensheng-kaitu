import { KaituError, type Workspace } from "@kaitu/core";
import type { ChannelMessage } from "./channel.js";
import { readState, sessionPath, writeState } from "./state.js";

export type ChannelAnswer = (prompt: string, signal: AbortSignal) => Promise<string>;

export class AgentRunner {
  private abort = new AbortController();

  constructor(
    private ws: Workspace,
    private reply?: ChannelAnswer,
  ) {}

  stop(): void {
    this.abort.abort();
  }

  async answer(message: ChannelMessage): Promise<string> {
    if (!this.reply) return "请先在电脑上的开图里连接 AI";
    const file = sessionPath(message.channel, message.chatId);
    const session = readState<{ turns: { user: string; assistant: string }[] }>(this.ws, file, { turns: [] });
    const prompt = [
      "这是用户从手机发来的消息。按开图的写入和确认规则处理，回复要短。",
      ...session.turns.slice(-5).map((turn) => `用户：${turn.user}\n助手：${turn.assistant}`),
      `用户：${message.text}`,
    ].join("\n\n");
    const answer = (await this.reply(prompt, this.abort.signal)).trim();
    this.abort.signal.throwIfAborted();
    if (!answer) throw new KaituError("AI 没有返回文本，请重试", "AI_CONNECTION");
    session.turns = [...session.turns, { user: message.text, assistant: answer }].slice(-5);
    writeState(this.ws, file, session);
    return answer;
  }
}
