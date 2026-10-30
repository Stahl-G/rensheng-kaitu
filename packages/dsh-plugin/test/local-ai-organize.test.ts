import { rmSync } from "node:fs";
import {
  adoptOnboardingMatter,
  captureNoteOnce,
  matterPrompt,
  onboardingStatus,
  pasteOnboardingMatter,
  readCalendar,
  readHome,
  readHomeSources,
  readLibrary,
  readOnboardingMatter,
  readOverviewPage,
  saveOnboardingMatter,
} from "@kaitu/core";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";
import { freshWorkspace } from "../../core/test/helpers.js";
import { AskPage } from "../src/client/AskPage.js";
import { LibraryPage } from "../src/client/LibraryPage.js";
import { OnboardingMatter } from "../src/client/OnboardingMatter.js";
import { OverviewPage, type OverviewPageProps } from "../src/client/OverviewPage.js";
import { LifeHome } from "../src/client/TodayPage.js";

vi.mock("../src/client/PaperMap.js", () => ({ PaperMap: () => null }));
afterEach(() => vi.unstubAllGlobals());

test.each(["library", "today"])(
  "%s 无Key入口可复制、回填并采纳，坏回答可手改且原文只存一份",
  async (entry) => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", {
      body: { hasAttribute: () => false },
      addEventListener() {},
      removeEventListener() {},
      getElementById: () => null,
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("addEventListener", () => {});
    vi.stubGlobal("removeEventListener", () => {});
    vi.stubGlobal(
      "EventSource",
      class {
        close() {}
      },
    );
    let copied = "";
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async (value: string) => {
          copied = value;
        },
      },
    });
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const method = url.split("/").at(-1) ?? "";
      requests.push(method);
      const values: Record<string, unknown> = {
        askSettings: { configured: false, protocols: [], providers: [], localAgents: [] },
        askList: [],
        overview: { projects: [], allNext: [], notes: [] },
        automation: { asked: true, tasks: {} },
      };
      return { ok: true, json: async () => values[method] ?? {} };
    });
    const ws = await freshWorkspace();
    const original = "用户：我想写完一篇短文。\nAI：先写开头，再核对。";
    let source = "";
    let pending: Promise<unknown> = Promise.resolve();
    const track = <T>(promise: Promise<T>) => {
      pending = promise;
      return promise;
    };
    const props = {
      loadPreferences: async () => ({ locale: "zh-CN", followSystem: false }),
      load: () => readOverviewPage(ws),
      loadHome: async () => ({ data: readHome(await readHomeSources(ws)), loading: false, error: null }),
      loadCalendar: async () => readCalendar(ws),
      loadMe: async () => ({}),
      loadOnboarding: async () => onboardingStatus(ws),
      loadCalendarPush: async () => ({}),
      loadProjects: async () => [],
      loadLibrary: async (query) => readLibrary(ws, query),
      searchLibraryNotes: async () => [],
      captureOnce: (text, id) =>
        track(
          captureNoteOnce(ws, text, id).then((result) => {
            source = result.path ?? "";
            return result;
          }),
        ),
      saveOnboardingMatter: (text) =>
        track(
          saveOnboardingMatter(ws, text).then((result) => {
            source = result.source;
            return result;
          }),
        ),
      readOnboardingMatter: async (file) => readOnboardingMatter(ws, file),
      promptOnboardingMatter: async (file) => matterPrompt(readOnboardingMatter(ws, file).text),
      pasteOnboardingMatter: (file, answer) => track(pasteOnboardingMatter(ws, file, answer)),
      adoptOnboardingMatter: (file, draft, path) => track(adoptOnboardingMatter(ws, file, draft, path)),
      renderAsk: (
        _prompt,
        _configureRequest,
        _configureBuiltin,
        _onConnections,
        _promptRequest,
        active,
        _onToday,
        _onSettings,
        _newConversation,
        autoSubmit,
        onOrganize,
      ) => createElement(AskPage, { workspace: ws.root, active, autoSubmit, onOrganize }),
    } as OverviewPageProps;
    let app!: ReturnType<typeof create>;
    const click = async (label: string) => {
      await act(async () => {
        const button = app.root.findAllByType("button").find((item) => item.children.includes(label));
        expect(button).toBeDefined();
        button?.props.onClick();
        await pending.catch(() => {});
      });
    };
    try {
      await act(async () => {
        app = create(createElement(OverviewPage, props));
      });
      await vi.waitFor(() => expect(app.root.findAllByType(LifeHome)).toHaveLength(1));
      if (entry === "library") {
        await act(async () => {
          app.root
            .findAllByType("button")
            .find((button) => button.findAllByType("span").some((span) => span.children.includes("资料")))
            ?.props.onClick();
        });
        await click("粘贴一段对话");
        const library = () => app.root.findByType(LibraryPage);
        await act(async () =>
          library()
            .findByType("textarea")
            .props.onChange({ target: { value: original } }),
        );
        await act(async () =>
          library()
            .findByType("form")
            .props.onSubmit({ preventDefault() {} }),
        );
      } else {
        await act(async () => app.root.findByType(LifeHome).props.setAskText(original));
        await act(async () => {
          app.root
            .findByType(LifeHome)
            .findByType("form")
            .props.onSubmit({ preventDefault() {} });
          await pending;
        });
        expect(JSON.stringify(app.toJSON())).not.toContain(source);
        await click("用其他 AI 整理");
      }
      await click("1 · 复制整理提示词");
      expect(copied).toContain(original);
      expect(copied).not.toContain("inbox/notes/");
      const review = () => app.root.findByType(OnboardingMatter);
      const answer = () => review().findByProps({ "aria-label": "AI 的回答" });
      const reply =
        entry === "library"
          ? "【目标】写完短文\n【现状】尚未开始\n【下一步】写第一段"
          : "这不是要求的回答格式";
      await act(async () => answer().props.onChange({ target: { value: reply } }));
      await click("3 · 读取回答");
      if (entry === "today") {
        expect(JSON.stringify(app.toJSON())).toContain("没读到【目标】");
        expect(answer().props.value).toBe(reply);
        const fields = review().findAllByType("label");
        for (const [name, value] of [
          ["当前目标", "写完短文"],
          ["一个下一步", "写第一段"],
        ]) {
          const field = fields.find((label) =>
            label.findAllByType("b").some((b) => b.children.includes(name)),
          );
          await act(async () => field?.findByType("textarea").props.onChange({ target: { value } }));
        }
      }
      expect(readOnboardingMatter(ws, source).text).toContain(original);
      await click("采纳这个下一步");
      const overview = await readOverviewPage(ws);
      expect(overview.plans.goals).toHaveLength(1);
      expect(overview.plans.goals[0]).toMatchObject({ title: "写完短文", next: { title: "写第一段" } });
      expect(readLibrary(ws).inbox.filter((row) => row.text === original)).toHaveLength(1);
      expect(overview.inboxNotes).toBe(0);
      expect(requests).not.toContain("askSend");
    } finally {
      if (app) await act(async () => app.unmount());
      rmSync(ws.root, { recursive: true, force: true });
    }
  },
);
