import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";
import { createAskService } from "../../cli/src/ui/ask.js";
// @ts-expect-error Desktop adapters are native ESM.
import { createPageGenerator, pageBundle } from "../creator-generation.mjs";
// @ts-expect-error Desktop adapters are native ESM.
import { createCreatorService } from "../creator.mjs";

const answer = JSON.stringify({
  title: "合成书架",
  description: "按阅读进度排列合成书目",
  icon: "M4 4h16v16H4z",
  code: "(() => { globalThis.executed = true; return function Page() { return h('p', null, 'Synthetic'); }; })()",
});

test("生成仅收发文字，关闭回合后才交审，确认前不执行代码，修订与重启保留源码", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-creator-generation-"));
  let notify: (method: string, params: unknown) => void = () => {};
  let release = () => {};
  let closing = () => {};
  const closingStarted = new Promise<void>((resolve) => {
    closing = resolve;
  });
  let close = () =>
    new Promise<void>((resolve) => {
      release = resolve;
      closing();
    });
  const runtime = vi.fn(async (_mode, _connection, textOnly) => {
    expect(textOnly).toBe(true);
    return {
      onNotification: (listener: typeof notify) => {
        notify = listener;
      },
      request: async (method: string, params: { sessionId: string }) => {
        if (method === "session/prompt") {
          notify("session.event", {
            sessionId: params.sessionId,
            event: {
              seq: 1,
              type: "assistant/message",
              data: { message: { content: [{ type: "text", text: answer }] } },
            },
          });
          notify("session.status", { sessionId: params.sessionId, status: "idle" });
        }
        return {};
      },
      close: () => close(),
    };
  });
  const ask = createAskService({
    state: root,
    workspace: root,
    runtime,
    settings: async () => ({ configured: true, backend: "dsh", provider: "synthetic", model: "synthetic" }),
    configure: async () => ({}),
    models: async () => [],
  });
  const install = vi.fn(async () => {});
  const creator = createCreatorService({ directory: join(root, "creator"), plugins: { install } });
  const generator = createPageGenerator({ creator, ask });
  try {
    expect(generator.start({ prompt: "合成阅读书架" }).status).toBe("generating");
    await closingStarted;
    expect(generator.status().status).toBe("generating");
    expect(creator.list()).toEqual([]);
    await expect(ask.prepareRelocation()).rejects.toThrow();
    expect(install).not.toHaveBeenCalled();
    release();
    await generator.settled();
    const { id, revision } = generator.status().draft;
    const review = creator.inspect(id, revision);
    expect(install).not.toHaveBeenCalled();
    expect(review.files["index.js"]).toBe("export function apply() {}\n");
    expect(createCreatorService({ directory: join(root, "creator"), plugins: { install } }).list()).toEqual(
      creator.list(),
    );
    await creator.install({ ...review, confirmed: true });
    // Only after confirmation, exercise the Client factory in a disposable context.
    let module: { factory: (require: (name: string) => unknown) => { apply: (ctx: unknown) => void } };
    const sandbox = {
      window: {
        __ModuleLoader__: {
          load: (value: typeof module) => {
            module = value;
          },
        },
      },
    };
    runInNewContext(review.files["client.js"], sandbox);
    expect((sandbox as { executed?: boolean }).executed).toBeUndefined();
    const register = vi.fn();
    module
      ?.factory(() => ({ createElement: () => null }))
      .apply({ slots: { inject: (_name: string, fn: () => void) => fn(), register } });
    expect(register.mock.calls[0][0]).toMatchObject({ name: "main", key: review.name });
    expect((sandbox as { executed?: boolean }).executed).toBe(true);
    close = async () => {};
    generator.start({ prompt: "改成列表", id, revision });
    await generator.settled();
    expect(generator.status().draft.name).toBe(review.name);
    expect(generator.status().draft.revision).not.toBe(revision);
    expect(install).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await ask.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("本机 ACP、无效生成结果或关闭失败均不产生可安装草稿，原页面保持", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-creator-generation-refused-"));
  const creator = createCreatorService({ directory: join(root, "creator"), plugins: { install: vi.fn() } });
  const original = creator.stage(pageBundle(creator.identity().name, answer));
  const background = vi.fn();
  const ask = { settings: async () => ({ configured: true, backend: "local" }), background };
  const generator = createPageGenerator({ creator, ask });
  try {
    generator.start({ prompt: "合成页面" });
    await generator.settled();
    expect(generator.status().status).toBe("failed");
    expect(background).not.toHaveBeenCalled();
    ask.settings = async () => ({ configured: true, backend: "dsh" });
    let listener: (event: unknown) => void = () => {};
    const service = {
      create: async () => ({ id: "synthetic" }),
      subscribe: (_id: string, fn: typeof listener) => {
        listener = fn;
        return () => {};
      },
      events: () => [
        { type: "assistant/message", data: { message: { content: [{ type: "text", text: "{invalid" }] } } },
      ],
      send: async () => {
        listener({ type: "session.status", data: { status: "idle" } });
      },
      cancel: async () => {},
      close: vi.fn(async () => {}),
    };
    background.mockReturnValue(service);
    generator.start({ prompt: "合成页面" });
    await generator.settled();
    expect(generator.status().status).toBe("failed");
    expect(service.close).toHaveBeenCalled();
    service.events = () => [
      { type: "assistant/message", data: { message: { content: [{ type: "text", text: answer }] } } },
    ];
    service.close.mockRejectedValueOnce(new Error("synthetic close failure"));
    generator.start({ prompt: "合成页面" });
    await generator.settled();
    expect(generator.status()).toMatchObject({ status: "failed", error: "synthetic close failure" });
    expect(creator.list()).toHaveLength(1);
    expect(creator.inspect(original.id, original.revision)).toEqual(original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
