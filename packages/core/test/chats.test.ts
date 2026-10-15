import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { importChatgptConversations, listChatFiles, readChat } from "../src/chats.js";
import { history, restore } from "../src/history.js";
import { validateWorkspace } from "../src/validate.js";
import { freshWorkspace, tmp } from "./helpers.js";

const created = Date.parse("2026-09-30T20:00:00Z") / 1000;

function conversation() {
  const message = (id: string, role: string, parts: unknown[], ts: number | null = null) => ({
    id,
    author: { role },
    create_time: ts,
    content: { content_type: "text", parts },
  });
  return {
    id: "synthetic-chat",
    title: "训练计划",
    create_time: created,
    update_time: created + 60.125,
    current_node: "answer",
    mapping: {
      root: { id: "root", message: null, parent: null, children: ["system"] },
      system: { id: "system", message: message("s", "system", [""]), parent: "root", children: ["question"] },
      question: {
        id: "question",
        message: message(
          "q",
          "user",
          ["看看训练", { content_type: "image_asset_pointer", asset_pointer: "private" }],
          created,
        ),
        parent: "system",
        children: ["discarded", "answer"],
      },
      discarded: {
        id: "discarded",
        message: message("old", "assistant", ["旧分支"]),
        parent: "question",
        children: [],
      },
      answer: {
        id: "answer",
        message: message("a", "assistant", ["当前分支"]),
        parent: "question",
        children: [],
      },
    },
  };
}

describe("ChatGPT 对话导入", () => {
  it("只取显示的分支，重复导入不生成版本，恢复后对话消失", async () => {
    const ws = await freshWorkspace();
    const initial = (await history(ws))[0];
    const input = join(tmp(), "conversations.json");
    writeFileSync(input, JSON.stringify([conversation()]));
    const imported = await importChatgptConversations(ws, input);
    expect(imported.added).toBe(1);
    expect(imported.version).not.toBeNull();
    const file = "chats/2026/10/synthetic-chat.jsonl";
    expect(listChatFiles(ws)).toEqual([file]);
    const stored = readChat(ws, file);
    expect(stored.header.created).toBe("2026-10-01T04:00:00+08:00");
    expect(stored.header.updated).toBe("2026-10-01T04:01:00.125+08:00");
    expect(stored.messages.map((message) => [message.id, message.role, message.text, message.ts])).toEqual([
      ["q", "user", "看看训练\n[图片]", "2026-10-01T04:00:00+08:00"],
      ["a", "assistant", "当前分支", null],
    ]);
    expect(validateWorkspace(ws)).toEqual([]);
    const versions = await history(ws);
    expect(versions).toHaveLength(2);
    expect((await importChatgptConversations(ws, input)).skipped).toBe(1);
    expect(await history(ws)).toEqual(versions);
    await restore(ws, initial?.oid as string);
    expect(listChatFiles(ws)).toEqual([]);
  });

  it("zip：预览不写入，更新覆盖同一对话，非法 id 整批拒绝", async () => {
    const ws = await freshWorkspace();
    const input = join(tmp(), "export.zip");
    const original = conversation();
    const writeZip = (data: unknown[]) =>
      writeFileSync(
        input,
        zipSync({
          "export/conversations.json": strToU8(JSON.stringify(data)),
          "other.txt": strToU8("无关文件"),
        }),
      );
    writeZip([original]);
    expect((await importChatgptConversations(ws, input, { dryRun: true })).added).toBe(1);
    expect(listChatFiles(ws)).toEqual([]);
    expect(await history(ws)).toHaveLength(1);
    await importChatgptConversations(ws, input);
    original.update_time += 0.125;
    original.mapping.answer.message.content.parts = ["更新后的回答"];
    writeZip([original]);
    const updated = await importChatgptConversations(ws, input);
    expect(updated.updated).toBe(1);
    expect(readChat(ws, updated.entries[0]?.file as string).messages.at(-1)?.text).toBe("更新后的回答");
    expect(listChatFiles(ws)).toHaveLength(1);
    expect(await history(ws)).toHaveLength(3);
    writeZip([
      { ...original, id: "valid-new-chat" },
      { ...original, id: "../../escape" },
    ]);
    await expect(importChatgptConversations(ws, input)).rejects.toThrow();
    expect(listChatFiles(ws)).toHaveLength(1);
    expect(await history(ws)).toHaveLength(3);
  });
});
