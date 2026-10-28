import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  archiveInboxNote,
  captureNoteOnce,
  deferSnapshots,
  inboxNotes,
  readCaptureReceipt,
} from "../src/index.js";
import { Workspace } from "../src/workspace.js";
import { freshWorkspace } from "./helpers.js";

it("reuses one receipt after a lost response or snapshot failure without writing the note twice", async () => {
  const ws = await freshWorkspace();
  try {
    deferSnapshots(ws, () => {
      throw new Error("synthetic snapshot failure");
    });
    const operationId = randomUUID();
    expect(readCaptureReceipt(ws, operationId)).toEqual({ status: "not_found", path: null });
    const saved = await captureNoteOnce(ws, "合成原文\n第二行", operationId);
    expect(saved).toMatchObject({ status: "saved", version: null, versionError: true });
    const retry = await captureNoteOnce(ws, "合成原文\n第二行", operationId);
    expect(retry).toMatchObject({ status: "saved", path: saved.path });
    const reopened = new Workspace(ws.root, { maintain: false });
    expect(readCaptureReceipt(reopened, operationId)).toEqual({ status: "saved", path: saved.path });
    expect(inboxNotes(ws).filter((note) => note.kind === "capture")).toHaveLength(1);
    await expect(captureNoteOnce(ws, "不同内容", operationId)).rejects.toMatchObject({ code: "CONFLICT" });
    if (!saved.path) throw new Error("capture path missing");
    archiveInboxNote(ws, saved.path);
    expect(readCaptureReceipt(ws, operationId)).toEqual({ status: "uncertain", path: null });
    expect(await captureNoteOnce(ws, "合成原文\n第二行", operationId)).toMatchObject({
      status: "uncertain",
      path: null,
    });
    expect(inboxNotes(ws)).toHaveLength(0);
    expect(inboxNotes(ws, "inbox/notes/done")).toHaveLength(1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("two concurrent requests with the same key do not create two notes", async () => {
  const ws = await freshWorkspace();
  try {
    deferSnapshots(ws, () => {});
    const operationId = randomUUID();
    const [first, second] = await Promise.all([
      captureNoteOnce(ws, "并发原文", operationId),
      captureNoteOnce(ws, "并发原文", operationId),
    ]);
    expect(first.status).toBe("saved");
    expect(second).toMatchObject({ status: "saved", path: first.path });
    expect(inboxNotes(ws).filter((note) => note.kind === "capture")).toHaveLength(1);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

it("an interrupted write remains uncertain and is not silently retried", async () => {
  const ws = await freshWorkspace();
  try {
    const operationId = randomUUID();
    const write = vi.spyOn(ws, "writeText");
    write.mockImplementationOnce(() => {
      throw new Error("synthetic write failure");
    });
    await expect(captureNoteOnce(ws, "合成原文", operationId)).rejects.toThrow("synthetic write failure");
    write.mockRestore();
    expect(readCaptureReceipt(ws, operationId)).toEqual({ status: "uncertain", path: null });
    expect(await captureNoteOnce(ws, "合成原文", operationId)).toMatchObject({
      status: "uncertain",
      path: null,
    });
    expect(inboxNotes(ws)).toHaveLength(0);
    expect(() => readCaptureReceipt(ws, "../invalid")).toThrow();
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});
