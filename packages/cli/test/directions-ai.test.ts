import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, readExploration, writeExploration } from "@kaitu/core";
import { expect, it, vi } from "vitest";
import { type AskRuntime, createAskService } from "../src/ui/ask.js";
import { directionGeneration } from "../src/ui/directions-ai.js";

it("独立研究保存建议，用户采纳和拒绝后换批保留决定与来源", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-directions-"));
  const ws = await initWorkspace(join(temp, "workspace"), { timeZone: "Asia/Shanghai" });
  let batch = 0;
  const ask = createAskService({
    state: join(temp, "state"),
    workspace: ws.root,
    settings: async () => ({ configured: true, provider: "fake", model: "fake" }),
    configure: async () => ({}),
    runtime: async (mode): Promise<AskRuntime> => {
      expect(mode).toBe("scoped");
      let notify: Parameters<AskRuntime["onNotification"]>[0] = () => {};
      return {
        onNotification(listener) {
          notify = listener;
          return () => {};
        },
        async close() {},
        async request(_method, params) {
          batch++;
          const emit = (seq: number, type: string, data: object) =>
            notify("session.event", { sessionId: params.sessionId, event: { seq, type, data } });
          const url = `https://example.org/research/${batch}`;
          emit(0, "tool/call", { name: "web_search", callId: "search" });
          emit(1, "tool/result", {
            message: { toolCallId: "search", content: [{ type: "text", text: url }] },
          });
          emit(2, "assistant/message", {
            message: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    Array.from({ length: batch === 1 ? 3 : 4 }, (_, index) => ({
                      operation: "create_direction",
                      data: {
                        title: `合成方向 ${batch}-${index}`,
                        motivation: "me/profile.md：喜欢户外。来源日期 2026-10-16",
                        hypothesis: "试试户外创作。一周内花一小时拍三张照片，观察是否愿意继续。",
                        unknowns: "可用时间",
                        references: [
                          { kind: "source", ref: "me/profile.md" },
                          { kind: "source", ref: url },
                        ],
                      },
                    })),
                  ),
                },
              ],
            },
          });
          notify("session.status", { sessionId: params.sessionId, status: "idle" });
          return {};
        },
      };
    },
  });
  try {
    const chat = await ask.create();
    const first = await directionGeneration(ws, true, ask);
    expect(first?.status).toBe("running");
    await vi.waitFor(() => expect(first?.status).toBe("done"), { timeout: 10000 });
    const initial = readExploration(ws).directions;
    expect(initial).toHaveLength(3);
    expect(initial.every((item) => item.status === "suggested" && item.references?.length === 2)).toBe(true);
    const [adopt, reject] = initial;
    if (!adopt || !reject) throw new Error("缺少合成建议");
    for (const [item, status] of [
      [adopt, "active"],
      [reject, "dismissed"],
    ] as const)
      await writeExploration(ws, {
        operation: "update_direction",
        id: item.id,
        expected_revision: item.rev ?? 1,
        data: { status },
      });
    const next = await directionGeneration(ws, true, ask);
    await vi.waitFor(() => expect(next?.status).toBe("done"), { timeout: 10000 });
    const directions = readExploration(ws).directions;
    expect(directions.filter((item) => item.status === "suggested")).toHaveLength(4);
    expect(directions.find((item) => item.id === adopt.id)?.status).toBe("active");
    expect(directions.find((item) => item.id === reject.id)?.status).toBe("dismissed");
    expect(ask.list().map((item) => item.id)).toEqual([chat.id]);
    expect(ask.events(chat.id)).toEqual([]);
  } finally {
    await ask.close();
    rmSync(temp, { recursive: true, force: true });
  }
}, 30000);
