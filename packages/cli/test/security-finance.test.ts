import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addRecord, initWorkspace, readRecords } from "@kaitu/core";
import { expect, it } from "vitest";
import { productRequest } from "../src/ui/product.js";

it("财务提交只接收当前工作区上传目录的文件，拒绝任意本机路径和链接，正常预览可提交", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-finance-entry-"));
  try {
    const ws = await initWorkspace(join(temp, "workspace"));
    const account = addRecord(ws, "finance_account", {
      name: "Synthetic",
      kind: "securities",
      source: "manual",
      currency: "CNY",
      ts: "2026-10-01T00:00:00+08:00",
    }).record.id;
    const bytes = Buffer.from("证券代码,证券名称,持仓数量,市价,币种\n000001,Synthetic,3,7.10,人民币\n");
    const external = join(temp, "external.csv");
    writeFileSync(external, bytes);
    for (const file of [external, "../external.csv", "finance/arbitrary.csv"]) {
      await expect(productRequest(ws, "financeImportCommit", [file, { account }])).rejects.toThrow();
    }
    const preview = (await productRequest(ws, "financeImportPreview", [
      "holdings.csv",
      bytes.toString("base64"),
      { account },
    ])) as { file: string };
    const original = ws.readBytes(preview.file);
    rmSync(ws.resolve(preview.file, { internal: true }));
    symlinkSync(external, ws.resolve(preview.file, { internal: true }));
    await expect(productRequest(ws, "financeImportCommit", [preview.file, { account }])).rejects.toThrow();
    expect(readRecords(ws, "finance_holding_snapshot")).toHaveLength(0);
    rmSync(join(ws.root, preview.file));
    ws.writeText(preview.file, original, { internal: true });
    await productRequest(ws, "financeImportCommit", [preview.file, { account }]);
    expect(readRecords(ws, "finance_holding_snapshot")).toHaveLength(1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
