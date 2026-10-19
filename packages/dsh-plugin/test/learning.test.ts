import { buildFrameDoc, buildWidgetDoc } from "@kaitu/core/teaching-frame";
import { expect, it } from "vitest";
import type { JsonValue, ToolDefinition } from "../src/dsh.js";
import { registerLearningAids } from "../src/learning-tools.js";

it("教学工具把 HTML 存入回放 metadata，模型只收简短确认；拒绝文档套壳、超限和取消", async () => {
  const tools = new Map<string, ToolDefinition>();
  registerLearningAids({
    tools: {
      register: (tool) => {
        tools.set(tool.name, tool);
        return () => {};
      },
    },
  });
  const card = tools.get("kaitu_learning_card");
  if (!card) throw new Error("missing teaching card");
  const exec = { signal: new AbortController().signal };
  const value = (await card.execute(
    { title: "合成概念卡", fragment: "<p>100 × 1.1 = 110</p>" },
    exec,
  )) as JsonValue;
  expect(card.output.presentationMeta?.({}, value)).toMatchObject({
    kind: "openmaic-render",
    fragment: "<p>100 × 1.1 = 110</p>",
  });
  expect(JSON.stringify(card.output.render({}, value))).not.toContain("<p>");
  await expect(card.execute({ title: "bad", fragment: "<html>bad</html>" }, exec)).rejects.toThrow();
  const widget = tools.get("kaitu_learning_widget");
  if (!widget) throw new Error("missing teaching widget");
  await expect(
    widget.execute({ title: "bad", widgetType: "simulation", html: "x".repeat(256 * 1024 + 1) }, exec),
  ).rejects.toThrow();
  const canceled = new AbortController();
  canceled.abort();
  await expect(
    card.execute({ title: "bad", fragment: "<p>x</p>" }, { signal: canceled.signal }),
  ).rejects.toThrow();
  for (const html of [
    buildWidgetDoc(
      "<!doctype html><html><head><title>x</title></head><body><script>void 0</script></body></html>",
      "call",
    ),
    buildFrameDoc({
      fragment: "<p>x</p>",
      title: "x",
      themeVars: {},
      colorScheme: "light",
      reportToken: "call",
    }),
  ]) {
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("connect-src blob: data:");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script>"));
  }
});

it("DSH Remote 沿用相同主题并通过生成契约返回，保存资料不等待版本写入", async () => {
  const { rmSync } = await import("node:fs");
  const { Context } = await import("@deepseek-ai/cordis");
  const { freshWorkspace } = await import("../../core/test/helpers.js");
  const { KaituOverviewService } = await import("../src/overview-service.js");
  const { TYPERT } = await import("../lib/typert.host.js");
  const ws = await freshWorkspace();
  let pending: Promise<unknown> = Promise.resolve();
  const service = new KaituOverviewService(new Context(), {}, ws, (run) => {
    const result = pending.then(run);
    pending = result.catch(() => {});
    return result;
  });
  try {
    const created = await service.learningStart({ title: "Synthetic remote learning" });
    expect(created.version).toBeNull();
    const saved = await service.learningSave({
      topic: created.topic,
      operationId: "remote-study-0001",
      understanding: "A real learner statement.",
      questions: "An unresolved question.",
      next: "One small step",
    });
    expect(saved.version).toBeNull();
    const contract = TYPERT as {
      invocations: {
        namespace: string;
        method: string;
        result: { create(): { parse(value: unknown): unknown } };
      }[];
    };
    const codec = contract.invocations.find(
      (entry) => entry.namespace === "kaitu" && entry.method === "learningRead",
    );
    expect(codec).toBeDefined();
    expect(codec?.result.create().parse(await service.learningRead(created.topic))).toMatchObject({
      notes: expect.stringContaining("A real learner statement."),
      next: [{ title: "One small step", status: "todo" }],
    });
    expect(await service.learningList()).toHaveLength(1);
  } finally {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await pending;
    rmSync(ws.root, { recursive: true, force: true });
  }
});
