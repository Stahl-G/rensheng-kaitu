import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { archiveInboxNote } from "../src/inbox-notes.js";
import { processInbox } from "../src/inbox.js";
import { readLibrary } from "../src/library.js";
import { mediaLibraryLocation, readMediaImage, selectMediaLibrary } from "../src/media-library.js";
import { schemas } from "../src/schema.js";
import { ulid } from "../src/ulid.js";
import { freshWorkspace } from "./helpers.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGM0rt/EgA0wYRUdtBIAGfABdJ5cDhAAAAAASUVORK5CYII=",
  "base64",
);
it("设备绑定按工作区隔离，媒体原字节不进入资料目录且拒绝路径逃逸", async () => {
  const first = await freshWorkspace();
  const second = await freshWorkspace();
  const root = mkdtempSync(join(tmpdir(), "kaitu-media-test-"));
  try {
    mkdirSync(join(root, "2026/10"), { recursive: true });
    const name = "2026/10/原图 (1).PNG";
    writeFileSync(join(root, name), png);
    const before = second.readText("AGENTS.md");
    const otherLocation = mediaLibraryLocation(second);
    expect(selectMediaLibrary(first, root)).toBe(realpathSync(root));
    expect(mediaLibraryLocation(second)).toBe(otherLocation);
    expect(await readMediaImage(first, `media:${name}`)).toEqual({ bytes: png, contentType: "image/png" });
    expect(second.readText("AGENTS.md")).toBe(before);
    expect(first.exists(name)).toBe(false);
    expect(readFileSync(join(root, name))).toEqual(png);
    for (const extension of ["HEIC", "heif"]) {
      const unsupported = `2026/10/IMG_1234.${extension}`;
      const original = Buffer.from("synthetic unsupported original");
      writeFileSync(join(root, unsupported), original);
      expect(await readMediaImage(first, `media:${unsupported}`)).toBeNull();
      expect(readFileSync(join(root, unsupported))).toEqual(original);
    }
    await expect(readMediaImage(first, "media:2026/10/missing.png")).resolves.toBeNull();
    await expect(readMediaImage(first, "media:2026/10/../../outside.png")).rejects.toThrow();
    symlinkSync(join(first.root, "AGENTS.md"), join(root, "2026/10/escape.png"));
    await expect(readMediaImage(first, "media:2026/10/escape.png")).rejects.toThrow();
    expect(() => selectMediaLibrary(first, first.root)).toThrow();
    const validate = schemas().builtin("media-reference.schema.json");
    expect(validate("media:2026/13/image.png")).toBe(false);
    expect(validate("media:2026/10/..")).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});

it("缺少媒体文件仍可接收、显示和归档手机原文，引用不搬动或改写", async () => {
  const ws = await freshWorkspace();
  const emptyMedia = mkdtempSync(join(tmpdir(), "kaitu-missing-media-"));
  try {
    selectMediaLibrary(ws, emptyMedia);
    const name = `ios-3fa9c1d2-${ulid()}.note.md`;
    const content =
      "---\nkind: capture\ndate: 2026-10-23\nattachment: media:2026/10/IMG_1234.HEIC\n---\n\n保留合成原文\n![照片](media:2026/10/IMG_1234.HEIC)\n";
    ws.writeText(`inbox/agents/${name}`, content);
    await processInbox(ws, { stableMs: 0 });
    const path = `inbox/notes/2026-10-23/${name}`;
    expect(ws.readText(path)).toBe(content);
    expect(readLibrary(ws, { section: "inbox" }).inbox.find((item) => item.file === path)?.text).toContain(
      "保留合成原文",
    );
    expect(await readMediaImage(ws, "media:2026/10/IMG_1234.HEIC")).toBeNull();
    expect(ws.readText(archiveInboxNote(ws, path))).toBe(content);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
    rmSync(emptyMedia, { recursive: true, force: true });
  }
});

it("单条 YAML 头部损坏不阻断其他原文，并保留正文、读取错误和原件", async () => {
  const ws = await freshWorkspace();
  const broken = "inbox/notes/2026-10-29/broken.note.md";
  const valid = "inbox/notes/2026-10-29/saved.note.md";
  const original =
    "---\nagent: synthetic\ndate: 2026-10-29\nsource: A title: subtitle\n---\n\n完整合成原文\n第二段保持不变。\n";
  try {
    ws.writeText(broken, original);
    ws.writeText(valid, "---\nkind: capture\ndate: 2026-10-29\n---\n\n保存后可找回的合成原文\n完整末段。\n");
    for (const query of [undefined, { section: "inbox", source: "me" } as const]) {
      const entries = readLibrary(ws, query).inbox;
      expect(entries.find((entry) => entry.file === broken)).toMatchObject({
        error: "INVALID_FRONTMATTER",
        text: "完整合成原文\n第二段保持不变。",
        originalSource: null,
        date: null,
      });
      expect(entries.find((entry) => entry.text.includes("保存后可找回"))).toMatchObject({
        file: valid,
        text: "保存后可找回的合成原文\n完整末段。",
        source: "me",
      });
    }
    expect(ws.readText(broken)).toBe(original);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
