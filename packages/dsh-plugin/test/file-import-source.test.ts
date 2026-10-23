import { expect, it } from "vitest";
import { jsonImportSource } from "../src/client/file-import-source.js";

it("recognizes only explicit leading Nut AI or ChatGPT fields", async () => {
  expect(await jsonImportSource(new Blob(['{"format":"nutai.backup","tables":{} }']))).toBe("nut-ai");
  expect(
    await jsonImportSource(new Blob(['[{"id":"chat","title":"A \\"quote\\"","create_time":1,"mapping":{'])),
  ).toBe("chatgpt-conversations");
  for (const head of ['{"other":{"format":"nutai.backup"}}', '[{"text":"mapping"}]', '{"format":', "invalid"])
    expect(await jsonImportSource(new Blob([head]))).toBe("choose");
});

it("never reads beyond 64 KiB, even when the format marker comes later", async () => {
  const file = new Blob(['{"padding":"', "x".repeat(100000), '","format":"nutai.backup"}']);
  const reads: number[] = [];
  const original = file.slice.bind(file);
  file.text = async () => {
    throw new Error("Whole-file reads are forbidden");
  };
  file.slice = (start, end) => {
    const part = original(start, end);
    reads.push(part.size);
    return part;
  };
  expect(await jsonImportSource(file)).toBe("choose");
  expect(reads).toEqual([65536]);
});
