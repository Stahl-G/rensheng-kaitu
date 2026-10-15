import { Context } from "@deepseek-ai/cordis";
import { expect, it, vi } from "vitest";
import { type KaituSessionServices, openKaituSession } from "../src/client/agent-prompt.js";

it("开图入口注册自己的工作区、创建新会话并仅在新会话预填", async () => {
  const scope = new Context();
  const calls: string[] = [];
  const draft = vi.fn((text: string) => {
    calls.push(text);
  });
  let count = 0;
  const services: KaituSessionServices = {
    workspaces: {
      create: vi.fn(async ({ path }) => {
        calls.push(path);
        return { workspaceId: "kaitu" };
      }),
    },
    sessions: {
      create: vi.fn(async ({ workspaceId }) => {
        calls.push(workspaceId);
        return `new-${++count}`;
      }),
      scope: vi.fn(() => scope),
    },
    uiWorkspace: {
      openSession: vi.fn((id) => {
        calls.push(id);
      }),
    },
    conversation: { input: { for: vi.fn(() => ({ setDraft: draft })) } },
    layout: { beginNavigation: () => new AbortController().signal },
  };
  await openKaituSession(services, "/synthetic/kaitu", "记录今天的训练");
  await openKaituSession(services, "/synthetic/kaitu");
  expect(calls).toEqual([
    "/synthetic/kaitu",
    "kaitu",
    "new-1",
    "记录今天的训练",
    "/synthetic/kaitu",
    "kaitu",
    "new-2",
  ]);
  expect(services.sessions.scope).toHaveBeenCalledWith("new-1");
  expect(services.conversation.input.for).toHaveBeenCalledWith(scope);
  expect(draft).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  services.layout.beginNavigation = () => controller.signal;
  services.workspaces.create = async () => {
    controller.abort();
    return { workspaceId: "kaitu" };
  };
  expect(await openKaituSession(services, "/synthetic/kaitu", "启动恢复期间的草稿")).toBe(false);
  expect(count).toBe(2);
  expect(draft).toHaveBeenCalledTimes(1);
});
