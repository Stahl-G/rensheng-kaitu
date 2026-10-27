import {
  connectWorkspaceBackup,
  subscribeWorkspaceBackup,
  syncWorkspaceBackup,
  workspaceBackupStatus,
} from "@kaitu/core";
import { createElement } from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { clonedWorkspace } from "../../core/test/helpers.js";
import { WorkspaceBackup } from "../src/client/WorkspaceBackup.js";
import { LocaleContext } from "../src/client/i18n.js";

test("同步状态订阅保留未保存的范围选择；实际连接与同步结果显示在中英界面", async () => {
  const ws = await clonedWorkspace();
  let fail = false;
  const remote = {
    inspect: async () => ({ private: true, branch: "main" }),
    read: async () => {
      if (fail) throw new Error("synthetic offline");
      return { head: null, files: {} };
    },
    push: async () => "synthetic-head",
  };
  const request = vi.fn(async (action: string, input?: Record<string, unknown>) => {
    if (action === "gh-status") return { installed: true, authenticated: true, login: "synthetic" };
    if (action === "connect") return connectWorkspaceBackup(ws, input, remote);
    if (action === "sync") await syncWorkspaceBackup(ws, remote);
    return workspaceBackupStatus(ws);
  });
  const subscribe = (refresh: () => void) => subscribeWorkspaceBackup(ws, refresh);
  const page = (locale: "zh-CN" | "en", root = ws.root, drive: string | null = null) =>
    createElement(
      LocaleContext.Provider,
      { value: locale },
      createElement(WorkspaceBackup, {
        request,
        subscribe,
        pickFolder: async () => null,
        onActivated: async () => {},
        storage: { root, suggested: { drive, icloud: null, nutstore: null, home: "/synthetic" } },
      }),
    );
  let view!: ReactTestRenderer;
  try {
    await act(async () => {
      view = create(page("zh-CN"));
    });
    expect(
      view.root
        .findAllByType("input")
        .filter((input) => input.props.type === "checkbox")
        .map((input) => input.props.checked),
    ).toEqual([false, false]);
    expect(workspaceBackupStatus(ws).connection).toBeNull();
    expect(view.root.findAllByType("span").some((span) => span.children.includes(ws.root))).toBe(true);
    expect(JSON.stringify(view.toJSON())).toContain("GitHub 已授权，尚未连接资料库");

    await act(async () => {
      await connectWorkspaceBackup(ws, { repo: "synthetic/kaitu", text: false, records: false }, remote);
    });
    expect(JSON.stringify(view.toJSON())).toContain("普通资料范围尚未选择");
    const checkbox = view.root.findAllByType("input").find((input) => input.props.type === "checkbox");
    act(() => checkbox?.props.onChange({ target: { checked: true } }));
    await act(async () => {
      await syncWorkspaceBackup(ws, remote);
    });
    expect(checkbox?.props.checked).toBe(true);
    expect(workspaceBackupStatus(ws).connection?.text).toBe(false);
    const connect = view.root
      .findAllByType("button")
      .find((button) => button.children.includes("检查并连接"));
    await act(async () => {
      await connect?.props.onClick();
    });
    expect(request).toHaveBeenCalledWith("connect", expect.objectContaining({ text: true, records: false }));
    expect(workspaceBackupStatus(ws).connection?.text).toBe(true);
    expect(workspaceBackupStatus(ws).lastSync).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).toContain("当前连接尚未完成同步");

    const completed = workspaceBackupStatus(ws).lastSync;
    fail = true;
    await act(async () => {
      await syncWorkspaceBackup(ws, remote);
    });
    expect(workspaceBackupStatus(ws).lastSync).toBe(completed);
    expect(JSON.stringify(view.toJSON())).toContain("同步失败");
    expect(workspaceBackupStatus(ws).error).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).toContain(workspaceBackupStatus(ws).error);
    await act(async () => {
      view.update(page("en", "/synthetic/Drive/kaitu", "/synthetic/Drive"));
    });
    expect(JSON.stringify(view.toJSON())).toContain("Sync failed");
    expect(JSON.stringify(view.toJSON())).toContain("same local files use both Drive and GitHub");
    await act(async () => {
      view.update(page("en", "/synthetic/Drive-other/kaitu", "/synthetic/Drive"));
    });
    expect(JSON.stringify(view.toJSON())).not.toContain("same local files use both Drive and GitHub");
  } finally {
    if (view) act(() => view.unmount());
  }
});
