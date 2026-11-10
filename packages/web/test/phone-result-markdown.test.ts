import MarkdownIt from "markdown-it";
import { expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../../core/src/frontmatter.js";
import { applyPhoneActions } from "../../core/src/phone-actions.js";
import { addRecord, readRecords } from "../../core/src/records.js";
import { ulid } from "../../core/src/ulid.js";
import { clonedWorkspace } from "../../core/test/helpers.js";

it.each(["task", "status"] as const)(
  "%s phone result renders HTML-looking user input as literal Markdown code",
  async (kind) => {
    const ws = await clonedWorkspace();
    const text = "<b>raw HTML</b>\n<!-- injected ownership -->\u2028# fake heading";
    let args: object;
    if (kind === "task") {
      const task = addRecord(ws, "task", { title: "Synthetic task", status: "open" }, { by: "user" }).record;
      args = { file: "task", id: task.id, expected_rev: 1, result_text: text };
    } else {
      const path = "health/STATUS.md";
      const doc = parseFrontmatter<Record<string, unknown>>(ws.readText(path));
      const item = { id: "synthetic-result", title: "Synthetic step", status: "todo" };
      doc.data.next = [item];
      ws.writeText(path, stringifyFrontmatter(doc.data, doc.body));
      args = { file: path, id: item.id, expected_next: item, result_text: text };
    }
    const action = {
      client_id: ulid(),
      device: "1234abcd",
      at: new Date().toISOString(),
      op: "complete_next_result",
      args,
    };
    await applyPhoneActions(
      ws,
      `inbox/agents/ios-1234abcd-${action.client_id}.actions.jsonl`,
      JSON.stringify(action),
    );
    const body =
      kind === "task"
        ? String(readRecords(ws, "task")[0]?.notes)
        : parseFrontmatter(ws.readText("health/STATUS.md")).body;
    const renderer = new MarkdownIt({ html: true });
    const tokens = renderer.parse(body, {});
    expect(
      tokens.some((token) => token.type === "code_block" && token.content.includes("<b>raw HTML</b>")),
    ).toBe(true);
    const rendered = renderer.render(body);
    expect(rendered).toContain("&lt;b&gt;raw HTML&lt;/b&gt;");
    expect(rendered).not.toContain("<b>raw HTML</b>");
    expect(
      tokens
        .filter((token) => token.type === "html_block")
        .some((token) => token.content.includes("injected ownership")),
    ).toBe(false);
  },
);
