import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Workspace,
  addTask,
  adoptOnboardingMatter,
  createProject,
  deleteRecord,
  enableDrive,
  exportWorkspace,
  history,
  initWorkspace,
  parseFrontmatter,
  proposeBlock,
  readExploration,
  readRecordRevisions,
  readRecords,
  readStatus,
  restore,
  saveOnboardingMatter,
  setProject,
  snapshot,
  stateDirectory,
  stringifyFrontmatter,
  updateRecord,
  writeExploration,
} from "@kaitu/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const { unzipSync } = createRequire(new URL("../../core/package.json", import.meta.url))("fflate");
import { expect, it, vi } from "vitest";
import { syncInventory } from "../../core/src/sync-files.js";
import { createMcpServer } from "../src/mcp/server.js";

it("私有任务及完整修订留在本机，对外出口与同步目录无内容，旧副本及旧版本不能重新发布它们", async () => {
  const temp = mkdtempSync(join(tmpdir(), "kaitu-private-task-"));
  const client = new Client({ name: "synthetic-remote", version: "1" });
  let server: ReturnType<typeof createMcpServer> | undefined;
  try {
    const ws = await initWorkspace(join(temp, "workspace"));
    const project = await createProject(ws, { title: "private-project", kind: "personal" });
    const direction = await writeExploration(ws, {
      operation: "create_direction",
      data: {
        title: "synthetic-direction-681",
        motivation: "synthetic-motivation-681",
        hypothesis: "synthetic-hypothesis-681",
        references: [{ kind: "project", ref: project.slug }],
      },
    });
    const experiment = await writeExploration(ws, {
      operation: "create_experiment",
      data: {
        direction_id: direction.id,
        question: "synthetic-question-681",
        action: "synthetic-action-681",
        budget: "one hour",
        deadline: "2026-10-20",
        criteria: "synthetic-observation",
      },
    });
    await writeExploration(ws, {
      operation: "add_note",
      data: {
        direction_id: direction.id,
        experiment_id: experiment.id,
        kind: "evidence",
        text: "synthetic-evidence-681",
        stance: "supports",
      },
    });
    const marker = "synthetic-private-task-6283";
    const task = await addTask(ws, {
      title: marker,
      project: project.slug,
      due: "2026-10-16",
      notes: "original-notes",
    });
    updateRecord(ws, "task", task.record.id, { notes: "revised-notes" });
    await proposeBlock(ws, { title: marker, start: "09:00", end: "10:00", ref: task.record.id }, "synthetic");
    await proposeBlock(
      ws,
      {
        title: "synthetic-private-plan-path",
        start: "10:00",
        end: "11:00",
        ref: `projects/${project.slug}/STATUS.md`,
      },
      "synthetic",
    );
    const reassociated = await addTask(ws, { title: "synthetic-reassociated-private", due: "2026-10-16" });
    await proposeBlock(
      ws,
      { title: "synthetic-reassociated-private", start: "12:00", end: "13:00", ref: reassociated.record.id },
      "synthetic",
    );
    const plan = parseFrontmatter<Record<string, unknown>>(ws.readText("NOW.md"));
    ws.writeText(
      "NOW.md",
      stringifyFrontmatter(
        {
          ...plan.data,
          date: "2026-10-15",
          attention: [{ kind: "task", title: "synthetic-private-attention", ref: task.record.id }],
        },
        plan.body,
      ),
    );
    const deleted = await addTask(ws, { title: "synthetic-deleted-private", project: project.slug });
    updateRecord(ws, "task", deleted.record.id, { notes: "deleted-revision" });
    deleteRecord(ws, "task", deleted.record.id);
    const deletedRows = readRecordRevisions(ws, "task").filter((row) => row.id === deleted.record.id);
    const beforePrivate = (await snapshot(ws, "synthetic-before-private")) ?? (await history(ws))[0]?.oid;
    await addTask(ws, { title: "shared-task", due: "2026-10-16" });
    const readText = Workspace.prototype.readText;
    let failVerification = true;
    const verification = vi.spyOn(Workspace.prototype, "readText").mockImplementation(function (file) {
      const text = readText.call(this, file);
      if (this.privateRecords && /^me\/data\/tasks\/.*\.jsonl$/.test(file) && failVerification) {
        failVerification = false;
        return "synthetic-corrupted-copy";
      }
      return text;
    });
    try {
      await expect(setProject(ws, project.slug, { local_only: true })).rejects.toThrow();
      expect(readFileSync(join(ws.root, "me/data/tasks/2026-10.jsonl"), "utf8")).toContain(marker);
    } finally {
      verification.mockRestore();
    }
    new Workspace(ws.root);
    expect(ws.exists(".kaitu/project-visibility.json")).toBe(false);
    expect(readRecordRevisions(ws, "task").filter((row) => row.id === deleted.record.id)).toEqual(
      deletedRows,
    );
    expect(readRecords(ws, "task").some((row) => row.id === deleted.record.id)).toBe(false);
    const revisions = readRecordRevisions(ws, "task").filter((row) => row.id === task.record.id);
    expect(revisions.map((row) => row.notes)).toEqual(["original-notes", "revised-notes"]);
    expect(readRecords(ws, "task").some((row) => row.title === marker)).toBe(true);
    updateRecord(ws, "task", reassociated.record.id, { project: project.slug });
    expect(readRecordRevisions(ws, "task").filter((row) => row.id === reassociated.record.id)).toHaveLength(
      2,
    );
    const matter = await saveOnboardingMatter(ws, "synthetic ordinary original");
    const next = await adoptOnboardingMatter(ws, matter.source, {
      goal: "synthetic-private-onboarding-goal",
      current: "unknown",
      next: "synthetic-private-onboarding-task",
    });
    updateRecord(ws, "task", next.id, { project: project.slug });
    const newMarker = "synthetic-local-new-9348";
    const newTask = await addTask(ws, {
      title: newMarker,
      source: `./projects/${project.slug}/STATUS.md`,
      due: "2026-10-16",
    });
    expect((await history(ws)).some((row) => row.message.includes(newMarker))).toBe(false);
    const local = new Workspace(join(stateDirectory(ws.root), "local-projects"), {
      maintain: false,
      privateRecords: true,
    });
    expect((await history(local)).some((row) => row.message.includes(newMarker))).toBe(true);
    const drive = join(temp, "drive");
    mkdirSync(drive);
    await enableDrive(ws, { driveDir: drive });
    const currentLocal = new Workspace(join(stateDirectory(ws.root), "local-projects"), {
      maintain: false,
      privateRecords: true,
    });
    currentLocal.timeZone = () => ws.timeZone();
    const localBefore = (await history(currentLocal))[0]?.oid as string;
    updateRecord(ws, "task", task.record.id, { notes: "private-later-revision" });
    await snapshot(currentLocal, "synthetic-private-later");
    await restore(ws, localBefore);
    expect(readRecords(ws, "task").find((row) => row.id === task.record.id)?.notes).toBe("revised-notes");
    const sharedText = () =>
      syncInventory(ws.root)
        .files.map((file) => readFileSync(join(ws.root, file), "utf8"))
        .join("\n");
    expect(sharedText()).not.toContain(marker);
    expect(sharedText()).not.toContain(newMarker);
    for (const value of [
      "synthetic-private-onboarding-task",
      "synthetic-private-onboarding-goal",
      "synthetic-deleted-private",
      "synthetic-direction-681",
      "synthetic-question-681",
      "synthetic-evidence-681",
      "synthetic-private-plan-path",
      "synthetic-private-attention",
      "synthetic-reassociated-private",
    ])
      expect(sharedText()).not.toContain(value);
    expect(ws.readText("NOW.md")).toContain("synthetic-private-attention");
    expect(readExploration(ws).directions.some((row) => row.id === direction.id)).toBe(true);
    expect(readExploration(ws, true).directions).toEqual([]);
    expect(JSON.stringify(readStatus(ws, new Date("2026-10-16T12:00:00Z"), true))).not.toContain(marker);
    const exported = unzipSync(Buffer.from(exportWorkspace(ws).base64, "base64"));
    expect(Object.keys(exported).some((file) => file.includes(".kaitu"))).toBe(false);
    expect(
      Object.values(exported)
        .map((bytes) => Buffer.from(bytes).toString("utf8"))
        .join("\n"),
    ).not.toContain(newMarker);
    const backup = unzipSync(Buffer.from(exportWorkspace(ws, { includePrivate: true }).base64, "base64"));
    expect(Object.keys(backup).some((file) => file.includes(".kaitu"))).toBe(false);
    expect(
      Object.values(backup)
        .map((bytes) => Buffer.from(bytes).toString("utf8"))
        .join("\n"),
    ).toContain(newMarker);
    const privateRoot = ws.resolve(".kaitu/local-projects", { internal: true });
    renameSync(privateRoot, `${privateRoot}.saved`);
    symlinkSync(stateDirectory(ws.root), privateRoot);
    try {
      expect(() => exportWorkspace(ws, { includePrivate: true })).toThrow();
    } finally {
      rmSync(privateRoot);
      renameSync(`${privateRoot}.saved`, privateRoot);
    }
    const leaked = { ...revisions[0], id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", title: "synthetic-legacy-private" };
    ws.appendLine("me/data/tasks/2026-10.jsonl", JSON.stringify(leaked));
    const stale = {
      ...newTask.record,
      project: undefined,
      source: undefined,
      rev: 1,
      title: "synthetic-stale-without-project",
    };
    ws.appendLine("me/data/tasks/2026-10.jsonl", JSON.stringify(stale));
    server = createMcpServer(ws, "remote");
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    for (const [name, args] of [
      ["onboarding_status", {}],
      ["task_list", { status: "all" }],
      ["record_list", { type: "task" }],
      ["status", {}],
      ["exploration_read", {}],
      ["record_list", { type: "direction" }],
      ["record_list", { type: "exploration_experiment" }],
      ["read_file", { path: "NOW.md" }],
      ["read_file", { path: "OVERVIEW.md" }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain(marker);
      expect(JSON.stringify(result)).not.toContain(newMarker);
      expect(JSON.stringify(result)).not.toContain(leaked.title);
      expect(JSON.stringify(result)).not.toContain(stale.title);
      for (const value of [
        "synthetic-private-onboarding-task",
        "synthetic-private-onboarding-goal",
        "synthetic-deleted-private",
        "synthetic-direction-681",
        "synthetic-question-681",
        "synthetic-evidence-681",
        "synthetic-private-plan-path",
        "synthetic-private-attention",
        "synthetic-reassociated-private",
      ])
        expect(JSON.stringify(result)).not.toContain(value);
    }
    const remoteTask = await client.callTool({
      name: "task_add",
      arguments: { title: "synthetic-remote-private", source: `./projects/${project.slug}/STATUS.md` },
    });
    expect(remoteTask.isError).toBe(true);
    const rejected = await client.callTool({
      name: "exploration_write",
      arguments: {
        command: {
          operation: "add_note",
          data: { direction_id: direction.id, kind: "evidence", text: "remote-input", stance: "unclear" },
        },
      },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected)).not.toContain("synthetic-hypothesis-681");
    const reopened = new Workspace(ws.root);
    expect(readRecords(reopened, "task").some((row) => row.id === leaked.id)).toBe(true);
    expect(sharedText()).not.toContain(leaked.title);
    expect(sharedText()).not.toContain(stale.title);
    expect(readRecords(reopened, "task").find((row) => row.id === newTask.record.id)?.title).toBe(newMarker);
    await restore(reopened, beforePrivate as string);
    expect(sharedText()).not.toContain(marker);
    expect(sharedText()).not.toContain(newMarker);
    expect(sharedText()).not.toContain(leaked.title);
    expect(sharedText()).not.toContain(stale.title);
    expect(readRecords(reopened, "task").find((row) => row.id === newTask.record.id)?.title).toBe(newMarker);
    expect(sharedText()).not.toContain("synthetic-question-681");
    const writeText = Workspace.prototype.writeText;
    let interrupt = true;
    const interrupted = vi
      .spyOn(Workspace.prototype, "writeText")
      .mockImplementation(function (file, text, options) {
        const result = writeText.call(this, file, text, options);
        if (!this.privateRecords && /^me\/data\/tasks\/.*\.jsonl$/.test(file) && interrupt) {
          interrupt = false;
          throw new Error("synthetic interruption after copy");
        }
        return result;
      });
    try {
      await expect(setProject(reopened, project.slug, { local_only: false })).rejects.toThrow();
      expect(existsSync(reopened.resolve(".kaitu/project-visibility.json", { internal: true }))).toBe(true);
    } finally {
      interrupted.mockRestore();
    }
    new Workspace(reopened.root);
    expect(reopened.exists(".kaitu/project-visibility.json")).toBe(false);
    expect(readRecordRevisions(reopened, "task").filter((row) => row.id === deleted.record.id)).toEqual(
      deletedRows,
    );
    expect(readRecords(reopened, "task").some((row) => row.id === deleted.record.id)).toBe(false);
    expect(sharedText()).toContain(marker);
    expect(readRecordRevisions(reopened, "task").filter((row) => row.id === task.record.id)).toHaveLength(2);
    await setProject(reopened, project.slug, { local_only: true });
    expect(sharedText()).not.toContain(marker);
  } finally {
    await client.close();
    await server?.close();
    rmSync(temp, { recursive: true, force: true });
  }
}, 45000);
