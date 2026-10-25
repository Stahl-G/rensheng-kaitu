import { Context } from "@deepseek-ai/cordis";
import type { SessionReference } from "@deepseek-ai/dsh-api-session-controller/client";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { PluginAsk, type PluginAskServices } from "../src/client/PluginAsk.js";
import { createPanelNavigation, usePanelNavigation } from "../src/client/panel-navigation.js";
import { createPluginAskSession } from "../src/client/plugin-ask-session.js";

test("主面板卸载后回到原开图位置，不改变另一个插件实例的首次入口", () => {
  const navigation = createPanelNavigation();
  let current!: ReturnType<typeof usePanelNavigation>;
  function Page() {
    current = usePanelNavigation(navigation);
    return createElement("output", null, `${current.view}/${current.explore}/${current.healthTab}`);
  }
  let root!: ReactTestRenderer;
  act(() => {
    root = create(createElement(Page));
  });
  act(() => {
    current.setView("explore");
    current.setExplore("health");
    current.setHealthTab("睡眠与活动");
  });
  act(() => {
    root.update(null);
  });
  act(() => {
    root.update(createElement(Page));
  });
  expect(root.root.findByType("output").children).toEqual(["explore/health/睡眠与活动"]);

  act(() => {
    current.setExplore("modules");
  });
  act(() => {
    root.update(null);
  });
  act(() => {
    root.update(createElement(Page));
  });
  expect(root.root.findByType("output").children).toEqual(["explore/modules/睡眠与活动"]);
  act(() => {
    current.setView("records");
    current.setRecord("notes");
    current.setConnectionSection("plugins");
  });
  act(() => {
    root.update(null);
  });
  act(() => {
    root.update(createElement(Page));
  });
  expect(current.record).toBe("notes");
  expect(current.connectionSection).toBe("plugins");
  expect(createPanelNavigation().view).toBe("overview");
  act(() => {
    root.unmount();
  });
});

test("问问重挂载复用原生会话，插件卸载与打开失败都只释放自己持有的引用", async () => {
  const scope = new Context();
  const binding = {} as SessionReference["binding"];
  const release = vi.fn();
  const reference: SessionReference = {
    sessionId: "synthetic-session" as SessionReference["sessionId"],
    binding,
    ready: Promise.resolve(binding),
    release,
    [Symbol.dispose]: release,
  };
  const setDraft = vi.fn();
  const services: PluginAskServices = {
    workspacePath: async () => "/synthetic/kaitu",
    workspaces: { create: vi.fn(async () => ({ workspaceId: "synthetic-workspace" })) },
    sessions: {
      create: vi.fn(async () => reference.sessionId),
      retain: vi.fn(() => reference),
      scope: () => scope as ReturnType<PluginAskServices["sessions"]["scope"]>,
    },
    conversation: { input: { for: () => ({ setDraft }) } },
  };
  const session = createPluginAskSession(services);
  const shown: SessionReference[] = [];
  const SessionProvider: PropsRenderSlots<"kaitu.ask.chat">["SessionProvider"] = ({ session, children }) => {
    shown.push(session);
    return children;
  };
  const renderSlot: PropsRenderSlots<"kaitu.ask.chat">["renderSlot"] = () =>
    createElement("output", null, "native");
  const page = (prompt = "", promptRequest = 0) =>
    createElement(PluginAsk, {
      services,
      session,
      SessionProvider,
      renderSlot,
      prompt,
      promptRequest,
    });
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(page("合成预填", 1));
  });
  await act(async () => {
    root.update(null);
  });
  expect(release).not.toHaveBeenCalled();
  await act(async () => {
    root.update(page());
  });
  expect(shown.at(-1)).toBe(reference);
  expect(services.sessions.create).toHaveBeenCalledTimes(1);
  expect(services.sessions.retain).toHaveBeenCalledTimes(1);
  expect(setDraft).toHaveBeenCalledExactlyOnceWith("合成预填");
  await act(async () => {
    root.unmount();
  });
  session.dispose();
  session.dispose();
  expect(release).toHaveBeenCalledTimes(1);
  await expect(session.open()).rejects.toThrow("disposed");

  for (const disposeWhileOpening of [false, true]) {
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<SessionReference["binding"]>((_resolve, reject) => {
      rejectReady = reject;
    });
    const releasePending = vi.fn();
    const pendingReference = {
      ...reference,
      ready,
      release: releasePending,
      [Symbol.dispose]: releasePending,
    };
    const retain = vi.fn(() => pendingReference);
    const owner = createPluginAskSession({ ...services, sessions: { ...services.sessions, retain } });
    const opening = owner.open();
    const rejection = expect(opening).rejects.toThrow("open failed");
    await vi.waitFor(() => expect(retain).toHaveBeenCalledOnce());
    if (disposeWhileOpening) owner.dispose();
    rejectReady(new Error("open failed"));
    await rejection;
    owner.dispose();
    expect(releasePending).toHaveBeenCalledTimes(1);
  }
});
