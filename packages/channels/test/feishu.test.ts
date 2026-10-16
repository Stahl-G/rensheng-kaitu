import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inboxNotes, initWorkspace, processInbox } from "@kaitu/core";
import { expect, it } from "vitest";
import {
  FeishuCollector,
  type FeishuEvent,
  type FeishuFactory,
  feishuProvider,
} from "../src/collectors/feishu.js";
import { CollectorService } from "../src/collectors/service.js";

function contents(root: string): string {
  return readdirSync(root, { withFileTypes: true })
    .map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? contents(path) : readFileSync(path, "utf8");
    })
    .join("\n");
}
it("飞书长连接接收群 post 与机器人私信，重投不重写，App Secret 留本机，断开后停止接收", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kaitu-feishu-"));
  const ws = await initWorkspace(join(directory, "workspace"));
  const root = join(directory, "local");
  const appSecret = "synthetic-feishu-private-secret";
  let handler: ((event: FeishuEvent) => Promise<void>) | undefined;
  const factory: FeishuFactory = () => ({
    async start(receive, state) {
      handler = receive;
      state(true);
    },
    stop() {},
  });
  const service = new CollectorService(ws, root, {
    feishu: { ...feishuProvider, create: (context) => new FeishuCollector(context, factory) },
  });
  const group: FeishuEvent = {
    sender: { sender_id: { open_id: "ou_test" }, tenant_key: "test-tenant" },
    message: {
      message_id: "om_group_post",
      chat_id: "oc_group",
      chat_type: "group",
      message_type: "post",
      create_time: "1792126800000",
      content: JSON.stringify({
        zh_cn: {
          title: "Review",
          content: [
            [
              { tag: "at", user_name: "Ada" },
              { tag: "text", text: `Please review ${"合成".repeat(300)}PRIVATE_BODY_TAIL` },
            ],
          ],
        },
      }),
    },
  };
  try {
    const { id } = (await service.request("add", {
      kind: "feishu",
      label: "合成飞书",
      appId: "cli_0000000000000000",
      appSecret,
    })) as { id: string };
    if (!handler) throw new Error("没有启动长连接");
    await handler(group);
    const dm: FeishuEvent = {
      ...group,
      message: {
        ...group.message,
        message_id: "om_dm_text",
        chat_id: "oc_dm",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "Private hello" }),
      },
    };
    await handler(dm);
    await processInbox(ws, { stableMs: 0 });
    const notes = inboxNotes(ws);
    expect(notes).toHaveLength(2);
    expect(notes.some((note) => note.content.includes("@AdaPlease review"))).toBe(true);
    expect(notes.some((note) => note.content.includes("Private hello"))).toBe(true);
    expect(contents(ws.root)).not.toContain("PRIVATE_BODY_TAIL");
    const before = notes.map((note) => statSync(ws.resolve(note.path)).mtimeMs);
    await handler(group);
    await handler(dm);
    expect(inboxNotes(ws).map((note) => statSync(ws.resolve(note.path)).mtimeMs)).toEqual(before);
    expect(readdirSync(ws.resolve("inbox/agents"))).toHaveLength(0);
    expect(contents(ws.root)).not.toContain(appSecret);
    expect(JSON.stringify(await service.request("list"))).not.toContain(appSecret);
    expect(
      readdirSync(root).some(
        (file) => file.endsWith(".json") && readFileSync(join(root, file), "utf8").includes(appSecret),
      ),
    ).toBe(true);
    await service.request("disconnect", { id });
    await handler({ ...group, message: { ...group.message, message_id: "om_after_disconnect" } });
    expect(readdirSync(ws.resolve("inbox/agents"))).toHaveLength(0);
    expect(contents(root)).not.toContain(appSecret);
  } finally {
    await service.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
