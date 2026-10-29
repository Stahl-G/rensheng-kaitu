import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
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
    for (const name of ["life-atlas", "library"]) {
      ws.writeJson(`phone/${name}.json`, {
        format: `kaitu.phone.${name}`,
        title: "Synthetic private finance",
      });
      symlinkSync(ws.resolve(`phone/${name}.json`), join(root, `${name}-alias.json`));
      expect(ws.readText(`phone/${name}.json`)).toContain("Synthetic private finance");
    }
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
          "phone/life-atlas.json",
          "phone/library.json",
          "life-atlas-alias.json",
          "library-alias.json",
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
