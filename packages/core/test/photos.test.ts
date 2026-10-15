import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  addPhotoBytes,
  history,
  readRecords,
  removePhoto,
  restore,
  validateWorkspace,
} from "../src/index.js";
import { freshWorkspace } from "./helpers.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII=",
  "base64",
);
it("拒绝非图片，不写记录或版本", async () => {
  const ws = await freshWorkspace();
  const before = await history(ws);
  await expect(
    addPhotoBytes(ws, Buffer.from("not an image"), { pose: "front", by: "user" }),
  ).rejects.toThrow();
  expect(readRecords(ws, "photo")).toEqual([]);
  expect(await history(ws)).toEqual(before);
});
it("添加照片复制原件、写合法记录和一个版本，删除后可从历史恢复", async () => {
  const ws = await freshWorkspace();
  const before = (await history(ws)).length;
  const added = await addPhotoBytes(ws, png, { pose: "front", ts: "2026-10-14T18:00:00+08:00", by: "user" });
  const file = `health/${added.record.file}`;
  expect(file.startsWith("health/files/photos/2026-10-14-")).toBe(true);
  expect(readFileSync(ws.resolve(file))).toEqual(png);
  expect(readRecords(ws, "photo")).toEqual([added.record]);
  expect(validateWorkspace(ws)).toEqual([]);
  expect((await history(ws)).length).toBe(before + 1);
  await removePhoto(ws, added.record.id);
  expect(ws.exists(file)).toBe(false);
  expect(readRecords(ws, "photo")).toEqual([]);
  await restore(ws, added.version as string);
  expect(readFileSync(ws.resolve(file))).toEqual(png);
  expect(readRecords(ws, "photo")).toEqual([added.record]);
});
