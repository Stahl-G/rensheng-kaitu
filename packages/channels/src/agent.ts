import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import type { Workspace } from "@kaitu/core";
import type { ChannelMessage } from "./channel.js";
import { readState, sessionPath, writeState } from "./state.js";

interface Session {
  threadId?: string;
  turns: { user: string; assistant: string }[];
}

export class AgentRunner {
  private active = new Set<() => void>();

  constructor(private ws: Workspace) {}

  stop(): void {
    for (const cancel of this.active) cancel();
  }

  async answer(message: ChannelMessage): Promise<string> {
    const file = sessionPath(message.channel, message.chatId);
    const session = readState<Session>(this.ws, file, { turns: [] });
    const config = this.ws.readJson<{ channels?: { agent_command?: string } }>(".kaitu/config.json");
    const command = config.channels?.agent_command;
    if (command !== undefined && (typeof command !== "string" || !command.trim())) {
      throw new Error("channels.agent_command 必须是非空命令字符串");
    }
    const codex = command === undefined;
    const history = !codex || !session.threadId ? session.turns.slice(-5) : [];
    const prompt = [
      "这是用户从手机发来的消息。在当前工作区按 AGENTS.md 处理，遵守其中的写入和确认规则，回复要短。",
      ...history.map((turn) => `用户：${turn.user}\n助手：${turn.assistant}`),
      `用户：${message.text}`,
    ].join("\n\n");
    const output = this.ws.resolve(`.kaitu/channels/answer-${randomUUID()}.tmp`, { internal: true });
    const args = session.threadId
      ? [
          "exec",
          "-s",
          "workspace-write",
          "resume",
          "--json",
          "--skip-git-repo-check",
          "-o",
          output,
          session.threadId,
          "-",
        ]
      : ["exec", "-s", "workspace-write", "--json", "--skip-git-repo-check", "-o", output, "-"];
    try {
      const result = await this.execute(codex ? "codex" : command, codex ? args : [], prompt, codex);
      if (codex) {
        for (const line of result.split("\n")) {
          try {
            const event = JSON.parse(line) as { type: string; thread_id?: string };
            if (event.type === "thread.started" && event.thread_id) session.threadId = event.thread_id;
          } catch {
            // 只读取 JSONL 会话事件，其他 stdout 不作为回答。
          }
        }
      }
      const answer = (codex ? readFileSync(output, "utf8") : result).trim();
      if (!answer) throw new Error("Agent 没有返回文本");
      if (!codex) session.threadId = undefined;
      session.turns = [...session.turns, { user: message.text, assistant: answer }].slice(-5);
      writeState(this.ws, file, session);
      return answer;
    } finally {
      rmSync(output, { force: true });
    }
  }

  private execute(command: string, args: string[], prompt: string, codex: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.ws.root,
        shell: !codex,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "ignore"],
      });
      let stdout = "";
      let failure: Error | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          // 进程可能已经退出。
        }
      };
      const cancel = (reason = "Agent 已停止") => {
        if (failure) return;
        failure = new Error(reason);
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1500);
      };
      this.active.add(cancel);
      const timer = setTimeout(() => cancel("Agent 处理超过 3 分钟，已停止"), 180_000);
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(killTimer);
        if (failure) kill("SIGKILL");
        this.active.delete(cancel);
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (Buffer.byteLength(stdout) > 2_000_000) cancel("Agent 输出过大，已停止");
      });
      child.stdin.on("error", () => {});
      child.once("error", () => {
        cleanup();
        reject(new Error("无法启动本机 Agent，请检查命令是否已安装"));
      });
      child.once("close", (code) => {
        cleanup();
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`Agent 退出码 ${code ?? "未知"}，请在电脑端检查登录与配置`));
        else resolve(stdout);
      });
      child.stdin.end(prompt);
    });
  }
}
