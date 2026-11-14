import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { AskPage } from "../src/client/AskPage.js";
import { DocumentBody } from "../src/client/DocumentBody.js";
import { FilePicker, FileServicesContext } from "../src/client/DshFiles.js";

test("portrait only fills an empty draft and saved links open outside the conversation", async () => {
  const requests: string[] = [];
  const openPath = vi.fn();
  const services = { openPath, findFiles: async () => [], pickDirectory: async () => null };
  let configured = true;
  let stream: { onmessage?: (message: { data: string }) => void };
  vi.stubGlobal("fetch", async (url: string) => {
    const method = url.split("/").at(-1) ?? "";
    requests.push(method);
    const values: Record<string, unknown> = {
      askSettings: {
        configured,
        choice: "builtin",
        provider: "example",
        providerName: "Example",
        model: "user-model",
        protocols: [],
        providers: [],
        localAgents: [],
      },
      askList: [{ id: "existing", title: "Existing", created: "2026-11-01", updated: "2026-11-01" }],
      overview: { projects: [], allNext: [], notes: [] },
      automation: { asked: true, tasks: {} },
    };
    return { ok: true, json: async () => values[method] ?? {} };
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.stubGlobal(
    "EventSource",
    class {
      constructor() {
        stream = this;
      }
      onmessage?: (message: { data: string }) => void;
      close() {}
    },
  );
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:text/plain;base64,c3ludGhldGlj";
      onload?: () => void;
      readAsDataURL() {
        this.onload?.();
      }
    },
  );
  let app!: ReturnType<typeof create>;
  const wrap = (child: ReturnType<typeof createElement>) =>
    createElement(FileServicesContext.Provider, { value: services }, child);
  try {
    await act(async () => {
      app = create(wrap(createElement(AskPage, { workspace: "synthetic" })));
    });
    const input = () => app.root.findByType("textarea");
    const button = () =>
      app.root.find((item) => item.type === "button" && item.children.includes("生成我的人生开图"));
    const type = async (value: string) =>
      act(async () => input().props.onChange({ target: { value, selectionStart: value.length } }));
    await act(async () => button().props.onClick());
    expect(input().props.value).toBe("按 life-portrait 技能，为我生成人生开图");
    expect(button().props.disabled).toBe(true);
    await type("unfinished draft");
    await act(async () => button().props.onClick());
    expect(input().props.value).toBe("unfinished draft");
    await type("");
    await act(async () =>
      app.root.findByProps({ type: "file" }).props.onChange({
        target: { files: [{ name: "synthetic.txt", type: "text/plain", size: 9 }], value: "" },
      }),
    );
    expect(button().props.disabled).toBe(true);
    await act(async () => button().props.onClick());
    expect(input().props.value).toBe("");
    expect(app.root.findAllByProps({ "aria-label": "移除 synthetic.txt" })).toHaveLength(1);
    await act(async () => app.root.findByProps({ "aria-label": "移除 synthetic.txt" }).props.onClick());
    await type("@");
    await act(async () =>
      app.root.findByType(FilePicker).props.select("projects/synthetic/STATUS.md", "file"),
    );
    expect(input().props.value).toBe("");
    expect(button().props.disabled).toBe(true);
    await act(async () => button().props.onClick());
    expect(app.root.findAllByProps({ "aria-label": "移除引用 projects/synthetic/STATUS.md" })).toHaveLength(
      1,
    );
    expect(input().props.value).toBe("");
    await act(async () =>
      app.root
        .findAllByType("button")
        .find((item) => item.children.includes("Existing"))
        ?.props.onClick(),
    );
    expect(
      app.root.findAll((item) => item.type === "button" && item.children.includes("生成我的人生开图")),
    ).toHaveLength(0);
    await act(async () =>
      stream.onmessage?.({
        data: JSON.stringify({
          id: "synthetic-message",
          type: "user/message",
          data: { content: "Synthetic question" },
        }),
      }),
    );
    expect(
      app.root.findAll((item) => item.type === "button" && item.children.includes("生成我的人生开图")),
    ).toHaveLength(0);
    configured = false;
    await act(async () =>
      app.update(wrap(createElement(AskPage, { key: "unconfigured", workspace: "synthetic" }))),
    );
    expect(button().props.disabled).toBe(false);
    await act(async () => button().props.onClick());
    expect(input().props.value).toBe("按 life-portrait 技能，为我生成人生开图");
    expect(requests).not.toContain("askSend");
    expect(requests).not.toContain("askCreate");

    const path = "reviews/portrait/2026-11-01-2.html";
    await act(async () =>
      app.update(
        wrap(createElement(DocumentBody, { content: `[打开人生开图](${path})\n\n<script>throw 1</script>` })),
      ),
    );
    expect(openPath).not.toHaveBeenCalled();
    expect(app.root.findAllByType("iframe")).toHaveLength(0);
    expect(app.root.findAllByType("script")).toHaveLength(0);
    await act(async () =>
      app.root
        .findAllByType("button")
        .find((item) => item.children.includes(path))
        ?.props.onClick(),
    );
    expect(openPath).toHaveBeenCalledWith(path, "open");
  } finally {
    await act(async () => app?.unmount());
    vi.unstubAllGlobals();
  }
});
