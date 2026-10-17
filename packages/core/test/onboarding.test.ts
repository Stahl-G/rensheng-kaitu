import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { startUi } from "../../cli/src/ui/server.js";
import {
  addGoalNext,
  addMemory,
  addRecord,
  adoptOnboardingMatter,
  changeOnboardingNext,
  configureAutomation,
  confirmOnboardingMemory,
  confirmOnboardingSetup,
  draftOnboardingMatter,
  history,
  inboxNoteDone,
  initWorkspace,
  keepOnboardingMatter,
  listMemories,
  listProjects,
  listTasks,
  onboardingStatus,
  parseFrontmatter,
  parseMemoryPaste,
  previewOnboardingMemory,
  previewOnboardingSetup,
  readExploration,
  readMe,
  readOnboardingMatter,
  readOverviewPage,
  recordOnboardingAiConnection,
  resetOnboarding,
  restore,
  saveOnboardingChoices,
  saveOnboardingMatter,
  stringifyFrontmatter,
  validateWorkspace,
} from "../src/index.js";

it("粘贴解析保留未知与不合格式行，处理列表、时间及已有和批内重复", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  try {
    const ws = await initWorkspace(join(root, "ws"));
    await addMemory(ws, { type: "preference", name: "language", text: "用中文" });
    const candidates = parseMemoryPaste(
      [
        "- [偏好] 用中文",
        "1. [人物] 小林是同事 (2026-09)",
        "[人物] 小林是同事 (2026-09)",
        "- [健康] 乳糖不耐 （2024）",
        "[没见过的类] 原样内容 (时间不详)",
        "格式没对上，别丢",
        "- 喜欢散步",
        "1. 喜欢散步",
        "",
        "[偏好]",
      ].join("\n"),
      listMemories(ws),
    );
    expect(candidates.map((item) => [item.type, item.text])).toEqual([
      ["person", "小林是同事 (2026-09)"],
      ["context", "乳糖不耐 （2024）"],
      ["context", "[没见过的类] 原样内容 (时间不详)"],
      ["context", "格式没对上，别丢"],
      ["context", "- 喜欢散步"],
      ["context", "[偏好]"],
    ]);
    expect(candidates[0]?.when).toBe("2026-09");
    expect(candidates[0]?.content).toBe("小林是同事");
    expect(candidates[2]?.raw).toBe(true);
    expect(listMemories(ws)).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("本地接口只确认预览中所选的记忆，整批一个版本并能撤销", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  const previousState = process.env.KAITU_LOCAL_STATE_DIR;
  process.env.KAITU_LOCAL_STATE_DIR = join(root, "state");
  const ws = await initWorkspace(join(root, "ws"));
  const ui = await startUi(ws, { port: 0, open: false, versionDelayMs: 10 });
  const call = (method: string, args: unknown[], origin = ui.url) =>
    fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kaitu": "1", Origin: origin },
      body: JSON.stringify(args),
    });
  try {
    const before = await history(ws);
    expect(
      (await call("onboardingMemoryPreview", ["不应写入", "claude"], "https://example.invalid")).status,
    ).toBe(403);
    const preview = await (
      await call("onboardingMemoryPreview", ["[偏好] 简洁\n[人物] 小张\n[工作] 写作", "claude"])
    ).json();
    expect(listMemories(ws)).toHaveLength(0);
    expect(await history(ws)).toEqual(before);
    expect((await call("onboardingMemoryConfirm", [preview.token, ["line-999"]])).status).toBe(400);
    const result = await (
      await call("onboardingMemoryConfirm", [preview.token, ["line-1", "line-2"]])
    ).json();
    expect(result.before).toBe(before[0]?.oid);
    expect(
      listMemories(ws)
        .map((entry) => entry.text)
        .sort(),
    ).toEqual(["小张", "简洁"]);
    expect(new Set(listMemories(ws).map((entry) => entry.source))).toEqual(new Set(["从 Claude 搬来"]));
    await vi.waitFor(async () => expect(await history(ws)).toHaveLength(before.length + 1), {
      timeout: 15000,
    });
    expect((await call("onboardingMemoryConfirm", [preview.token, ["line-1"]])).status).toBe(409);
    const repeated = previewOnboardingMemory(ws, "[偏好] 简洁", "claude");
    expect(repeated.candidates).toEqual([]);
    await confirmOnboardingMemory(ws, repeated.token, []);
    expect(await history(ws)).toHaveLength(before.length + 1);
    await restore(ws, result.before);
    expect(listMemories(ws)).toHaveLength(0);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    await ui.close();
    if (previousState === undefined) Reflect.deleteProperty(process.env, "KAITU_LOCAL_STATE_DIR");
    else process.env.KAITU_LOCAL_STATE_DIR = previousState;
    rmSync(root, { recursive: true, force: true });
  }
});

it("清单随实际数据与恢复变化，本机选择不改配置，已有资料换机不弹引导", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Ho_Chi_Minh" });
    const config = ws.readText(".kaitu/config.json");
    expect(onboardingStatus(ws, options).showGuide).toBe(true);
    await saveOnboardingChoices(
      ws,
      {
        seen: true,
        starts: ["health", "calendar", "projects", "news"],
        skipped: ["health"],
        aiChoice: "none",
      },
      options,
    );
    const before = await history(ws);
    await saveOnboardingChoices(ws, { starts: ["health", "calendar", "projects", "news"] }, options);
    expect(await history(ws)).toEqual(before);
    expect(
      parseFrontmatter<{ next: { id: string }[] }>(ws.readText("health/STATUS.md")).data.next,
    ).toHaveLength(1);
    expect(ws.readText(".kaitu/config.json")).toBe(config);
    const initial = onboardingStatus(ws, options);
    expect(initial.sources.map((source) => source.id)).toEqual(["calendar", "health", "projects", "news"]);
    expect(initial.checklist.completed).toBe(1);
    expect(initial.sources.find((item) => item.id === "health")).toMatchObject({
      done: false,
      skipped: true,
    });
    await addMemory(ws, { type: "fact", name: "home", text: "住在甲城" });
    await addRecord(
      ws,
      "meal",
      {
        ts: "2026-10-16T12:00:00+07:00",
        meal: "午",
        items: [{ name: "午餐" }],
        kcal: 500,
        protein_g: 25,
        source: "synthetic",
      },
      { by: "user" },
    );
    recordOnboardingAiConnection(ws, "synthetic", options);
    ws.writeText(
      "NOW.md",
      stringifyFrontmatter({
        date: "2026-10-16",
        generated_at: "2026-10-16T07:30:00+07:00",
        blocks: [],
        attention: [],
      }),
    );
    const folder = join(root, "project");
    mkdirSync(folder);
    const projectPreview = previewOnboardingSetup(
      ws,
      {
        source: "projects",
        project: { title: "Synthetic project", kind: "work", links: [{ path: folder, role: "folder" }] },
      },
      options,
    );
    const newsPreview = previewOnboardingSetup(ws, { source: "news", keywords: ["合成方向"] }, options);
    expect(onboardingStatus(ws, options).checklist.completed).toBe(4);
    await confirmOnboardingSetup(ws, projectPreview.token, options);
    await confirmOnboardingSetup(ws, newsPreview.token, options);
    expect(onboardingStatus(ws, options).checklist.completed).toBe(4);
    expect(onboardingStatus(ws, { stateRoot: join(root, "another-computer") }).showGuide).toBe(false);
    await restore(ws, before[0]?.oid as string);
    const restored = onboardingStatus(ws, options);
    expect(restored.checklist.items.find((item) => item.id === "memory")?.done).toBe(false);
    expect(restored.sources.find((item) => item.id === "health")?.done).toBe(false);
    expect(restored.checklist.items.find((item) => item.id === "plan")?.done).toBe(false);
    expect(restored.checklist.items.find((item) => item.id === "ai")?.done).toBe(true);
    expect(resetOnboarding(ws, options).showGuide).toBe(false);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("原文单独保存不生成待办，AI 草稿待核对，采纳一条带来源的下一步并可记结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-matter-"));
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Ho_Chi_Minh" });
    const original = "我在准备一个合成展览。AI 建议整理作品、联系场地、制作海报。";
    const matter = await saveOnboardingMatter(ws, original);
    expect(readOnboardingMatter(ws, matter.source).text.trim()).toBe(original);
    expect(() =>
      readOnboardingMatter(ws, matter.source.replace(/\d{4}-\d{2}-\d{2}/, "2000-01-01")),
    ).toThrow();
    expect(listTasks(ws)).toHaveLength(0);
    const input = { goal: "准备合成展览", current: "还没确定作品", next: "列出三件候选作品" };
    await draftOnboardingMatter(ws, matter.source, input);
    expect(listTasks(ws)).toHaveLength(0);
    expect(onboardingStatus(ws, { stateRoot: join(root, "state") }).draft?.draft).toEqual(input);
    await keepOnboardingMatter(ws, matter.source);
    expect(listTasks(ws)).toHaveLength(0);
    expect(onboardingStatus(ws, { stateRoot: join(root, "state") }).draft).toBeNull();
    await draftOnboardingMatter(ws, matter.source, input);
    const paths = [
      {
        name: "整理已有作品",
        fit: "已有素材可用",
        unknown: "哪些作品适合展出",
        experiment: "挑出两件作品请朋友看",
      },
      {
        name: "先找观众反馈",
        fit: "能低成本验证主题",
        unknown: "谁对主题感兴趣",
        experiment: "找两位朋友各聊十分钟",
      },
    ];
    await draftOnboardingMatter(ws, matter.source, { ...input, next: "", paths });
    expect(readOnboardingMatter(ws, matter.source).draft?.paths).toEqual(paths);
    expect(listTasks(ws)).toHaveLength(0);
    await expect(adoptOnboardingMatter(ws, matter.source, input)).rejects.toThrow();
    const selected = { ...input, next: "先和一位朋友聊主题" };
    await expect(
      adoptOnboardingMatter(ws, matter.source, selected, {
        name: "旧的路径",
        fit: "旧的理由",
        unknown: "旧的未知",
        experiment: "旧的实验",
      }),
    ).rejects.toThrow();
    const next = await adoptOnboardingMatter(ws, matter.source, selected, paths[1]);
    await adoptOnboardingMatter(ws, matter.source, selected, paths[1]);
    expect(listTasks(ws)).toHaveLength(1);
    expect(listTasks(ws)[0]).toMatchObject({
      id: next.id,
      source: matter.source,
      title: selected.next,
      status: "open",
    });
    expect(listTasks(ws)[0]?.notes).toContain(paths[1]?.name);
    expect(matter.kind).toBe("note");
    const conversation = await saveOnboardingMatter(ws, "我：想准备展览。\nChatGPT：先挑作品。");
    expect(conversation.kind).toBe("conversation");
    expect(listTasks(ws)).toHaveLength(1);
    // 采纳后原文已归档：不再算待整理，依据仍按原路径读回；目标登记进 goals.json。
    await expect(inboxNoteDone(ws, matter.source)).rejects.toThrow();
    expect(readOnboardingMatter(ws, matter.source).text.trim()).toBe(original);
    // 没开每日整理时，原文只是「已保存」，界面不说「等待整理」。
    expect((await readOverviewPage(ws)).sync).toMatchObject({ received: 1, organizer: false });
    configureAutomation(ws, { organizer: true });
    expect((await readOverviewPage(ws)).sync.organizer).toBe(true);
    expect(readMe(ws).goals.map((goal) => goal.title)).toEqual([selected.goal]);
    expect(next.goalId).toBe(readMe(ws).goals[0]?.id);
    const later = await changeOnboardingNext(ws, next.id, next.rev, "defer", "2026-12-01");
    const done = await changeOnboardingNext(ws, next.id, later.rev, "complete", "选出了三件作品");
    expect(done).toMatchObject({
      status: "done",
      result: "选出了三件作品",
      source: matter.source,
      due: "2026-12-01",
    });
    await expect(changeOnboardingNext(ws, next.id, next.rev, "complete", "重试")).rejects.toThrow();
    expect(
      onboardingStatus(ws, { stateRoot: join(root, "state") }).checklist.items.find(
        (item) => item.id === "matter",
      )?.done,
    ).toBe(true);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("搬来的目标、项目和在考虑的事进对应模块，今天页列出目标并能定下一步、记结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-plans-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    const pasted = [
      "[工作] 在上海做了 4 年运营 （2026-08）",
      "[目标] 2027 年 3 月前转岗做产品",
      "[Goal] Run a half marathon",
      "[项目] 求职作品集",
      "[在考虑] 明年要不要搬去杭州",
      "[偏好] 喜欢被直接指出问题",
    ].join("\n");
    const english = previewOnboardingMemory(ws, pasted, "chatgpt", { ...options, locale: "en" });
    expect(english.candidates.find((item) => item.content === "Run a half marathon")?.category).toBe("Goals");
    const preview = previewOnboardingMemory(ws, pasted, "chatgpt", options);
    expect(preview.candidates.map((item) => item.target)).toEqual([
      "memory",
      "goal",
      "goal",
      "project",
      "direction",
      "memory",
    ]);
    const work = preview.candidates[0]?.id as string;
    const result = await confirmOnboardingMemory(
      ws,
      preview.token,
      preview.candidates.map((item) => item.id),
      { ...options, targets: { [work]: "memory" } },
    );
    expect(result).toMatchObject({ goals: 2, projects: 1, directions: 1, skipped: 0 });
    expect(
      listMemories(ws)
        .map((entry) => entry.text)
        .sort(),
    ).toEqual(["喜欢被直接指出问题", "在上海做了 4 年运营 （2026-08）"]);
    expect(listProjects(ws).map((project) => project.title)).toEqual(["求职作品集"]);
    expect(readExploration(ws).directions).toEqual([
      expect.objectContaining({
        title: "明年要不要搬去杭州",
        status: "active",
        motivation: "从 ChatGPT 搬来：明年要不要搬去杭州",
      }),
    ]);
    const plans = (await readOverviewPage(ws)).plans;
    expect(plans.goals.map((goal) => [goal.title, goal.origin?.source, goal.next])).toEqual([
      ["2027 年 3 月前转岗做产品", "chatgpt", null],
      ["Run a half marathon", "chatgpt", null],
    ]);
    expect(plans).toMatchObject({ projects: 1, directions: 1 });
    const goal = plans.goals[0]?.id as string;
    const next = await addGoalNext(ws, goal, "这周写一份产品分析初稿");
    expect(next).toMatchObject({ kind: "goal", goalId: goal, goal: "2027 年 3 月前转岗做产品" });
    expect(onboardingStatus(ws, options).next?.id).toBe(next.id);
    await expect(addGoalNext(ws, goal, "再加一步")).rejects.toThrow();
    await changeOnboardingNext(ws, next.id, next.rev, "complete", "写完了门店排班的复盘");
    const after = (await readOverviewPage(ws)).plans.goals.find((item) => item.id === goal);
    expect(after).toMatchObject({ next: null, results: 1, lastResult: "写完了门店排班的复盘" });
    const again = await confirmOnboardingMemory(
      ws,
      previewOnboardingMemory(ws, "[目标] 2027 年 3 月前转岗做产品", "claude", options).token,
      ["line-1"],
      options,
    );
    expect(again.goals).toBe(0);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("搬入时括号里的条件和记下的时间都留着；已有记忆也能设为目标；前缀相同的长项目各自保留，重搬不重复", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-routes-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    await addMemory(ws, { type: "context", name: "thesis", text: "完成论文" });
    const long =
      "Ship the Kaitu desktop client with offline sync, local-first storage and a calm onboarding flow";
    const paste = [
      "[目标] 发布桌面版（优先 macOS）",
      "[目标] 2027 年 3 月前转岗做产品经理 （2026-08）",
      "[目标] 完成论文",
      "[事实] 完成论文",
      "[项目] 开图上线（先做邀请制）",
      `[项目] ${long} Volume II`,
      `[项目] ${long} for Windows`,
      "[在考虑] 是否去杭州（取决于孩子入学）",
    ].join("\n");
    const bring = async () => {
      const preview = previewOnboardingMemory(ws, paste, "chatgpt", options);
      const ids = preview.candidates.map((item) => item.id);
      return { preview, result: await confirmOnboardingMemory(ws, preview.token, ids, options) };
    };
    const { preview, result } = await bring();
    expect(preview.candidates.map((item) => item.target)).toEqual([
      "goal",
      "goal",
      "goal",
      "project",
      "project",
      "project",
      "direction",
    ]);
    expect(result).toMatchObject({ goals: 3, projects: 3, directions: 1 });
    expect(ws.readJson<{ title: string }[]>("me/goals.json").map((goal) => goal.title)).toEqual(
      expect.arrayContaining(["发布桌面版（优先 macOS）", "2027 年 3 月前转岗做产品经理", "完成论文"]),
    );
    const projects = listProjects(ws);
    expect(projects.map((project) => project.title)).toContain("开图上线（先做邀请制）");
    for (const volume of ["Volume II", "for Windows"])
      expect(
        projects.filter((project) =>
          ws.readText(`projects/${project.slug}/notes.md`).includes(`${long} ${volume}\n`),
        ),
      ).toHaveLength(1);
    expect(readExploration(ws).directions.map((item) => item.title)).toContain(
      "是否去杭州（取决于孩子入学）",
    );
    const done = join(ws.root, "inbox/notes/done");
    const archived = readdirSync(done).flatMap((day) =>
      readdirSync(join(done, day)).map((file) => readFileSync(join(done, day, file), "utf8")),
    );
    expect(archived.join("\n")).toContain("[目标] 2027 年 3 月前转岗做产品经理 （2026-08）");
    expect(archived.join("\n")).toContain("[在考虑] 是否去杭州（取决于孩子入学）");
    const again = await bring();
    expect(again.result).toMatchObject({ goals: 0, projects: 0, directions: 0 });
    expect(listProjects(ws)).toHaveLength(3);
    // 之后再搬来的「Volume I」是另一个项目，不能因为是「Volume II」的前缀被当成重复。
    const later = previewOnboardingMemory(ws, `[项目] ${long} Volume I`, "chatgpt", options);
    const added = await confirmOnboardingMemory(
      ws,
      later.token,
      later.candidates.map((item) => item.id),
      options,
    );
    expect(added).toMatchObject({ projects: 1 });
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("两个目标各有下一步：今天页卡片给还没做完的那一步，两个都能分别记结果、再定下一步", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-two-goals-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    ws.writeJson("me/goals.json", [
      { id: "note-20261001-aaaaaa", title: "目标 A", status: "active" },
      { id: "note-20261002-bbbbbb", title: "目标 B", status: "active" },
    ]);
    const a = await addGoalNext(ws, "note-20261001-aaaaaa", "A 的下一步");
    const b = await addGoalNext(ws, "note-20261002-bbbbbb", "B 的下一步");
    expect(onboardingStatus(ws, options).next?.id).toBe(b.id);
    await changeOnboardingNext(ws, b.id, b.rev, "complete", "B 做完了");
    expect(onboardingStatus(ws, options).next).toMatchObject({ id: a.id, status: "open" });
    await changeOnboardingNext(ws, a.id, a.rev, "complete", "A 做完了");
    const plans = (await readOverviewPage(ws)).plans.goals;
    expect(plans.map((goal) => [goal.title, goal.lastResult, goal.next])).toEqual([
      ["目标 A", "A 做完了", null],
      ["目标 B", "B 做完了", null],
    ]);
    await addGoalNext(ws, "note-20261001-aaaaaa", "A 的第二步");
    await addGoalNext(ws, "note-20261002-bbbbbb", "B 的第二步");
    expect((await readOverviewPage(ws)).plans.goals.map((goal) => goal.next?.title)).toEqual([
      "A 的第二步",
      "B 的第二步",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("没有方向模块的旧工作区也能搬入目标，「在考虑」记为记忆", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-legacy-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    rmSync(join(ws.root, "explore/module.json"));
    const preview = previewOnboardingMemory(
      ws,
      "[目标] 年底跑完半马\n[在考虑] 明年要不要搬去杭州",
      "chatgpt",
      options,
    );
    const result = await confirmOnboardingMemory(
      ws,
      preview.token,
      preview.candidates.map((item) => item.id),
      options,
    );
    expect(result).toMatchObject({ goals: 1, directions: 0 });
    expect(listMemories(ws).map((entry) => entry.text)).toContain("明年要不要搬去杭州");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("Agent 在 me/STATUS.md 手写没有 id 的下一步时，引导状态照常读取", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    ws.writeText("me/STATUS.md", "---\nnext:\n  - 和家人吃饭\n---\n");
    expect(() => onboardingStatus(ws, options)).not.toThrow();
    expect(onboardingStatus(ws, options).draft).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
