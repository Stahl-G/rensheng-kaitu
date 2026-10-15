import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Workspace,
  addRecord,
  completeNext,
  createProject,
  disableDrive,
  enableDrive,
  history,
  initWorkspace,
  listProjects,
  processInbox,
  readProject,
  readRecords,
  readStatus,
  readWorkbench,
  restore,
  setProject,
  stateDirectory,
  syncProject,
  validateWorkspace,
} from "@kaitu/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it, vi } from "vitest";
import { createMcpServer } from "../src/mcp/server.js";

it("Drive 迁移与本机设置隔离项目、旧 metric、OVERVIEW、remote 和收件箱，关闭后完整搬回", async () => {
  const home = fs.mkdtempSync(join(tmpdir(), "kaitu-project-drive-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_STATE_HOME", join(home, "state"));
  vi.stubEnv("LOCALAPPDATA", join(home, "local"));
  const client = new Client({ name: "synthetic-remote", version: "1" });
  let server: ReturnType<typeof createMcpServer> | undefined;
  try {
    const drive = join(home, "drive");
    fs.mkdirSync(drive);
    const manuscript = join(home, "manuscript");
    fs.mkdirSync(manuscript);
    fs.writeFileSync(join(manuscript, "body.md"), "秘密正文 synthetic words");
    const ws = await initWorkspace(join(home, "kaitu"));
    const privateProject = await createProject(ws, {
      title: "private-synthetic",
      kind: "work",
      local_only: true,
      links: [{ path: manuscript, role: "manuscript" }],
    });
    const sharedProject = await createProject(ws, { title: "shared-synthetic", kind: "personal" });
    await setProject(ws, privateProject.slug, {
      next: [{ id: "secret-next", title: "私人下一步", status: "todo" }],
    });
    await setProject(ws, sharedProject.slug, {
      next: [{ id: "shared-next", title: "公开下一步", status: "todo" }],
    });
    await syncProject(ws, privateProject.slug);
    expect(readRecords(ws, "project_metric")).toHaveLength(1);
    const localVersion = (await history(ws))[0]?.oid as string;
    await enableDrive(ws, { driveDir: drive });
    expect(fs.existsSync(join(ws.root, "projects", privateProject.slug))).toBe(false);
    expect(
      fs.existsSync(join(stateDirectory(ws.root), "local-projects", privateProject.slug, "STATUS.md")),
    ).toBe(true);
    expect(readRecords(ws, "project_metric")).toEqual([]);
    expect(ws.readText("OVERVIEW.md")).not.toContain("private-synthetic");
    expect(ws.readText("OVERVIEW.md")).not.toContain("私人下一步");
    expect(ws.readText("AGENT-README.md")).not.toContain("private-synthetic");
    expect(listProjects(ws)).toHaveLength(2);
    expect(readStatus(ws).projects).toHaveLength(2);
    expect(readWorkbench(ws).statuses.some((s) => s.data.next?.some((n) => n.id === "secret-next"))).toBe(
      true,
    );
    await completeNext(ws, `${readProject(ws, privateProject.slug).dir}/STATUS.md`, "secret-next");
    expect(readProject(ws, privateProject.slug).data.next?.[0]?.status).toBe("done");
    await syncProject(ws, privateProject.slug);
    expect(readRecords(ws, "project_metric")).toEqual([]);
    expect(listProjects(ws).find((p) => p.slug === privateProject.slug)?.words).toBe(6);
    await expect(
      Promise.resolve().then(() =>
        addRecord(ws, "project_metric", { project: privateProject.slug, kind: "words", value: 10 }),
      ),
    ).rejects.toThrow();
    server = createMcpServer(ws, "remote");
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    await client.connect(clientSide);
    const invoke = (name: string, args = {}) => client.callTool({ name, arguments: args });
    const listed = await invoke("project_list");
    const content = listed.content as { type: string; text: string }[];
    expect(JSON.parse(content[0]?.text ?? "[]").map((p: { slug: string }) => p.slug)).toEqual([
      sharedProject.slug,
    ]);
    const status = await invoke("status");
    expect(JSON.stringify(status)).not.toContain("private-synthetic");
    expect(JSON.stringify(status)).not.toContain("私人下一步");
    expect((await invoke("project_log", { slug: privateProject.slug, text: "remote write" })).isError).toBe(
      true,
    );
    expect(
      (await invoke("read_file", { path: `.kaitu/local-projects/${privateProject.slug}/STATUS.md` })).isError,
    ).toBe(true);
    expect(
      (
        await invoke("record_add", {
          type: "project_metric",
          data: { project: privateProject.slug, kind: "words", value: 10 },
        })
      ).isError,
    ).toBe(true);
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("project_sync");
    ws.writeText(
      "inbox/agents/private.records.jsonl",
      `${JSON.stringify({ type: "project_metric", project: privateProject.slug, kind: "words", value: 99 })}\n`,
    );
    expect((await processInbox(ws, { stableMs: 1 })).rejected).toHaveLength(1);
    const addedInDrive = await createProject(ws, {
      title: "drive-local",
      kind: "personal",
      local_only: true,
    });
    expect(readProject(ws, addedInDrive.slug).dir).toMatch(/^\.kaitu\/local-projects\//);
    await setProject(ws, privateProject.slug, { local_only: false });
    expect(readRecords(ws, "project_metric")).toHaveLength(1);
    expect(readProject(ws, privateProject.slug).dir).toBe(`projects/${privateProject.slug}`);
    await setProject(ws, privateProject.slug, { local_only: true });
    expect(readRecords(ws, "project_metric")).toEqual([]);
    expect(ws.readText("OVERVIEW.md")).not.toContain("private-synthetic");
    expect(validateWorkspace(ws)).toEqual([]);
    await restore(ws, localVersion);
    expect(fs.existsSync(join(ws.root, "projects", privateProject.slug))).toBe(false);
    expect(readRecords(ws, "project_metric")).toEqual([]);
    expect(ws.readText("OVERVIEW.md")).not.toContain("private-synthetic");
    await disableDrive(ws, { to: join(home, "back") });
    expect(readProject(ws, privateProject.slug).dir).toBe(`projects/${privateProject.slug}`);
    expect(readProject(ws, addedInDrive.slug).dir).toBe(`projects/${addedInDrive.slug}`);
    expect(readRecords(ws, "project_metric")).toHaveLength(1);
    expect(listProjects(new Workspace(ws.root))).toHaveLength(3);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    await client.close();
    await server?.close();
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
  }
}, 20000);
