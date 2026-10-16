import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addTask,
  createProject,
  initWorkspace,
  logProject,
  readProject,
  setProject,
  syncProject,
} from "@kaitu/core";
import { expect, it } from "vitest";
import type { AskEvent, AskService } from "../src/ui/ask.js";
import { productRequest } from "../src/ui/product.js";

it("AI 提议不保存，确认后显示目标，手稿同步自动更新实际进度", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-project-goal-"));
  try {
    const ws = await initWorkspace(join(root, "workspace"));
    const manuscript = join(root, "manuscript");
    mkdirSync(manuscript);
    const file = join(manuscript, "draft.md");
    writeFileSync(file, "星海");
    const { slug } = await createProject(ws, {
      title: "写作",
      kind: "personal",
      links: [{ path: manuscript, role: "manuscript" }],
    });
    const proposal = { label: "完成初稿", current: 2, target: 100, unit: "字" };
    let listener: ((event: AskEvent) => void) | undefined;
    const ask = {
      settings: async () => ({ configured: true }),
      create: () => ({ id: "goal-thread" }),
      subscribe: (_id: string, receive: typeof listener) => {
        listener = receive;
        return () => {};
      },
      events: () => [
        {
          type: "assistant/message",
          data: { message: { content: [{ type: "text", text: JSON.stringify(proposal) }] } },
        },
      ],
      send: async () => {
        listener?.({ id: 1, type: "session.status", data: { status: "idle" } });
      },
    } as unknown as AskService;
    const goal = await productRequest(ws, "projectGoalSuggest", [slug], ask);
    expect(readProject(ws, slug).data.progress).toBeUndefined();
    await productRequest(ws, "projectGoalSave", [slug, goal]);
    writeFileSync(file, "星海远航");
    expect((await syncProject(ws, slug)).issues).toEqual([]);
    const detail = (await productRequest(ws, "projectDetail", [slug])) as {
      progress: { current: number; target: number };
    };
    expect(detail.progress.current).toBe(4);
    expect(detail.progress.target).toBe(100);
    expect(readProject(ws, slug).data.progress?.current).toBe(4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("卡片显示关联待办和简短日志，详情保留完整进展，错误仓库地址不会覆盖绑定", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-project-card-"));
  try {
    const ws = await initWorkspace(root);
    const { slug } = await createProject(ws, { title: "作品集", kind: "personal" });
    const task = await addTask(ws, { title: "上传作品", project: slug });
    await setProject(ws, slug, { github: { repo: "owner/portfolio" } });
    await logProject(ws, slug, "4 次提交：第一条；第二条；第三条；第四条 <!-- sync:commits -->", {
      by: "user",
    });
    const cards = (await productRequest(ws, "projects", [])) as {
      next: { id: string }[];
      recentLog: { text: string };
    }[];
    expect(cards[0]?.next.map((item) => item.id)).toContain(task.record.id);
    expect(cards[0]?.recentLog.text).toBe("4 次提交：第一条；第二条");
    const detail = (await productRequest(ws, "projectDetail", [slug])) as { logs: { text: string }[] };
    expect(detail.logs[0]?.text).toContain("第三条；第四条");
    expect(detail.logs[0]?.text).not.toContain("<!--");
    await expect(productRequest(ws, "projectBindGithub", [slug, "not-a-repository"])).rejects.toThrow();
    expect(readProject(ws, slug).data.github?.repo).toBe("owner/portfolio");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
