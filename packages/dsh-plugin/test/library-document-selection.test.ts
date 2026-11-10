import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";
import { emptyLearningDraft } from "../src/client/LearningPage.js";
import { NotesPage } from "../src/client/LibraryPage.js";
import type { LibraryData } from "../src/types.js";

test("switching documents retains the list, ignores an old read, and retries the selected document", async () => {
  let first!: (value: string) => void;
  const load = vi.fn(
    (file: string): Promise<string> =>
      file === "notes/first.md"
        ? new Promise((resolve) => {
            first = resolve;
          })
        : Promise.reject(new Error("Read failed")),
  );
  const prompt = vi.fn();
  const data: LibraryData = {
    inbox: [],
    sections: [],
    notes: [
      { file: "notes/first.md", title: "First", kind: "笔记", status: null },
      { file: "decisions/second.md", title: "Second", kind: "决定", status: null },
    ],
  };
  const props = {
    data,
    initialFile: "notes/first.md",
    loadLibraryDocument: load,
    loadMediaImage: vi.fn(),
    loadLearning: vi.fn(),
    startLearning: vi.fn(),
    saveLearning: vi.fn(),
    topic: "",
    onTopic: vi.fn(),
    onSourceConsumed: vi.fn(),
    onPrompt: prompt,
    onSaved: vi.fn(),
    draft: emptyLearningDraft,
    onDraft: vi.fn(),
  };
  let app!: ReturnType<typeof create>;
  const button = (text: string) =>
    app.root
      .findAllByType("button")
      .find(
        (node) =>
          node.findAllByType("strong").some((strong) => strong.children.includes(text)) ||
          node.children.includes(text),
      );
  try {
    await act(async () => {
      app = create(createElement(NotesPage, props));
    });
    await act(async () => button("Second")?.props.onClick());
    await act(async () => first("Old source must not replace Second"));
    expect(JSON.stringify(app.toJSON())).not.toContain("Old source must not replace Second");
    expect(JSON.stringify(app.toJSON())).toContain("Read failed");
    expect(button("First")).toBeDefined();
    expect(button("Second")).toBeDefined();
    load.mockImplementation(async () => "Second document original");
    await act(async () => button("重试")?.props.onClick());
    expect(load.mock.calls.at(-1)).toEqual(["decisions/second.md"]);
    expect(JSON.stringify(app.toJSON())).toContain("Second document original");
    await act(async () => button("问问")?.props.onClick());
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining("decisions/second.md"));
    await act(async () => button("笔记")?.props.onClick());
    expect(button("Second")).toBeUndefined();
    expect(JSON.stringify(app.toJSON())).toContain("Second document original");
  } finally {
    await act(async () => app?.unmount());
  }
});
