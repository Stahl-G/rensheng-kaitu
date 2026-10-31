import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { agentReadFilter } from "../src/exposure.js";
import {
  addMemory,
  addRecord,
  agentCanRead,
  agentConnections,
  handoverPack,
  initWorkspace,
  readAgentFile,
  readFinanceAccess,
  readStatus,
  setFinanceAccess,
} from "../src/index.js";

it("各连接独立保存财务读取选择，敏感记忆、密钥和链接遵循同一文件边界", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-exposure-"));
  try {
    const ws = await initWorkspace(root);
    const open = await addMemory(ws, { type: "fact", name: "Open", text: "Synthetic open memory" });
    const secret = await addMemory(ws, {
      type: "fact",
      name: "Secret",
      text: "Synthetic private memory",
      sensitive: true,
    });
    ws.writeText("finance/note.md", "Synthetic finance");
    ws.writeText("me/secrets.json", "{}");
    for (const file of ["me/id_ecdsa", "me/id_ed25519_sk", "me/private.p8", "me/keys.jks"])
      ws.writeText(file, "Synthetic key material");
    symlinkSync(ws.resolve("me/id_ecdsa"), join(root, "key-alias.md"));
    symlinkSync(ws.resolve(`memory/${secret.file}`), join(root, "alias.md"));
    symlinkSync(ws.resolve("finance/note.md"), join(root, "finance-alias.md"));
    for (const connection of agentConnections) {
      expect(agentCanRead(ws, "finance/note.md", connection)).toBe(connection !== "remote-mcp");
      for (const allowed of [false, true]) {
        setFinanceAccess(ws, connection, allowed);
        expect(readFinanceAccess(ws)[connection]).toBe(allowed);
        expect(agentCanRead(ws, "finance/note.md", connection)).toBe(allowed);
        expect(agentCanRead(ws, "finance-alias.md", connection)).toBe(allowed);
        expect(agentCanRead(ws, `memory/${open.file}`, connection)).toBe(true);
        for (const file of [
          ".kaitu/config.json",
          "me/secrets.json",
          "me/id_ecdsa",
          "me/id_ed25519_sk",
          "me/private.p8",
          "me/keys.jks",
          "key-alias.md",
          `memory/${secret.file}`,
          "alias.md",
        ])
          expect(agentCanRead(ws, file, connection)).toBe(false);
        expect(readAgentFile(ws, "memory/MEMORY.md", connection)).toContain("Synthetic open memory");
        expect(readAgentFile(ws, "memory/MEMORY.md", connection)).not.toContain("Synthetic private memory");
        expect(
          readStatus(ws, new Date(), connection).modules.some((item) => item.file === "finance/STATUS.md"),
        ).toBe(allowed);
      }
    }
    setFinanceAccess(ws, "phone-ask", false);
    expect(readFinanceAccess(ws)["local-ask"]).toBe(true);
    expect(readFinanceAccess(ws)["phone-ask"]).toBe(false);
    expect(() => setFinanceAccess(ws, "unknown" as never, true)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("每份资料包按本次选择加入财务摘要，连接开关和敏感记忆保持独立", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-handover-finance-"));
  try {
    const ws = await initWorkspace(root);
    addRecord(ws, "finance_account", {
      name: "Synthetic wallet",
      kind: "wallet",
      source: "manual",
      currency: "CNY",
    });
    await addMemory(ws, { type: "fact", name: "Private", text: "Synthetic private memory", sensitive: true });
    for (const allowed of [false, true]) {
      const connection = { id: "handover", finance: allowed } as const;
      expect(agentCanRead(ws, "finance/note.md", connection)).toBe(allowed);
      const pack = handoverPack(ws, "en", new Date(), allowed);
      expect(pack.sections.some((section) => section.id === "finance")).toBe(allowed);
      expect(pack.text).not.toContain("Synthetic private memory");
      expect(readFinanceAccess(ws)["remote-mcp"]).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("a navigation scan resolves every target and a new scan observes changed roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-navigation-boundary-"));
  const outside = mkdtempSync(join(tmpdir(), "kaitu-navigation-outside-"));
  try {
    const ws = await initWorkspace(root);
    ws.writeText("learning/note.md", "Synthetic note");
    ws.writeText("finance/note.md", "Synthetic finance");
    writeFileSync(join(outside, "note.md"), "Outside");
    symlinkSync(ws.resolve("learning/note.md"), join(root, "alias.md"));
    const canRead = agentReadFilter(ws, { id: "handover", finance: false });
    expect(canRead("alias.md")).toBe(true);
    for (const target of [
      join(outside, "note.md"),
      ws.resolve("finance/note.md"),
      ws.resolve(".kaitu/config.json", { internal: true }),
    ]) {
      rmSync(join(root, "alias.md"));
      symlinkSync(target, join(root, "alias.md"));
      expect(canRead("alias.md")).toBe(false);
    }
    rmSync(join(root, "alias.md"));
    symlinkSync(join(outside, "missing.md"), join(root, "alias.md"));
    expect(canRead("alias.md")).toBe(false);
    ws.root = outside;
    expect(agentReadFilter(ws, { id: "handover", finance: false })("note.md")).toBe(true);
    expect(agentReadFilter(ws, { id: "handover", finance: false })(join(root, "learning/note.md"))).toBe(
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
