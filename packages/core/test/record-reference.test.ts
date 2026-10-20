import { rmSync } from "node:fs";
import { expect, it } from "vitest";
import { addRecords, recordReferences, writeAgentsMd } from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

it("所有内置与自定义记录的生成示例均通过实际写入校验", async () => {
  const ws = await freshWorkspace();
  try {
    ws.writeJson("books/module.json", {
      id: "books",
      name: "读书",
      version: 1,
      visibility: "agent",
      records: {
        reading: { path: "data/{YYYY-MM}.jsonl", schema: "schemas/reading.schema.json", label: "阅读" },
      },
    });
    ws.writeJson("books/schemas/reading.schema.json", {
      allOf: [{ $ref: "record-base.schema.json" }],
      required: ["title", "minutes", "format", "edition"],
      properties: {
        title: { type: "string", minLength: 3 },
        minutes: { type: "integer", minimum: 5, maximum: 60, multipleOf: 5 },
        format: { enum: ["paper", "ebook"] },
        edition: { $ref: "#/$defs/edition" },
        notes: { type: "string" },
      },
      $defs: { edition: { type: "string", pattern: "^v[0-9]+$", examples: ["v2"] } },
    });
    writeAgentsMd(ws);
    const references = recordReferences(ws);
    for (const { type, examples } of references) {
      const published = [
        ...ws.readText(`skills/record-format/${type}.md`).matchAll(/示例 JSONL：`([^`]+)`/g),
      ].map((match) => JSON.parse(match[1] ?? ""));
      expect(published).toHaveLength(examples.length);
      for (const example of published) {
        const { type: _type, ...input } = example;
        const [result] = addRecords(ws, type, [input], { dryRun: true });
        expect(result?.record).toMatchObject(input);
      }
    }
    expect(references.some((ref) => ref.type === "reading")).toBe(true);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
