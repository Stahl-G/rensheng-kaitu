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
  createProject,
  draftOnboardingMatter,
  history,
  inboxNoteDone,
  keepOnboardingMatter,
  listMemories,
  listProjects,
  listTasks,
  onboardingStatus,
  parseFrontmatter,
  parseMemoryPaste,
  previewOnboardingMemory,
  previewOnboardingSetup,
  processInbox,
  readExploration,
  readLibrary,
  readMe,
  readOnboardingMatter,
  readOverviewPage,
  recordOnboardingAiConnection,
  resetOnboarding,
  restore,
  saveOnboardingChoices,
  saveOnboardingMatter,
  splitImportedBlobs,
  stringifyFrontmatter,
  ulid,
  validateWorkspace,
} from "../src/index.js";
import { clonedWorkspace } from "./helpers.js";

it("不同日期同名原文分别读取、采纳或保留，归档冲突改名后仍按原始来源回读", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-matter-source-"));
  try {
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
    const name = "01aa0000000000000000000000.md";
    const sources = ["2020-01-02", "2020-01-03", "2020-01-04"].map((date, index) => {
      const source = `inbox/notes/${date}/${name}`;
      ws.writeText(source, stringifyFrontmatter({ kind: "capture", date, agent: "你" }, `合成原文${index}`));
      return source;
    });
    for (const [index, source] of sources.entries())
      expect(readOnboardingMatter(ws, source).text.trim()).toBe(`合成原文${index}`);
    for (const [index, source] of sources.entries()) {
      expect(readOnboardingMatter(ws, source).text.trim()).toBe(`合成原文${index}`);
      const draft = { goal: `目标${index}`, current: `现状${index}`, next: `下一步${index}` };
      await draftOnboardingMatter(ws, source, draft);
      if (index < 2) await adoptOnboardingMatter(ws, source, draft);
      else await keepOnboardingMatter(ws, source);
      expect(ws.exists(source)).toBe(false);
    }
    for (const [index, source] of sources.entries()) {
      expect(readOnboardingMatter(ws, source).text.trim()).toBe(`合成原文${index}`);
      expect(
        readLibrary(ws, { section: "inbox" }).inbox.find((entry) => entry.originalSource === source)?.text,
      ).toBe(`合成原文${index}`);
    }
    expect(
      listTasks(ws)
        .map((task) => task.source)
        .sort(),
    ).toEqual(sources.slice(0, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("粘贴解析保留未知与不合格式行，处理列表、时间及已有和批内重复", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  try {
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
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
        "[目标] 投稿散文 (2026-10) [在考虑] 老虎杯 (2026-10) [偏好] 不爱被说教",
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
      ["context", "投稿散文 (2026-10)"],
      ["context", "老虎杯 (2026-10)"],
      ["preference", "不爱被说教"],
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

it("连续标签各归目标和记忆，尾部分隔符不写入正文，隔天重复搬入不新增目标", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-inline-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T12:00:00+08:00"));
    const text = "[目标]完成纸桥模型[偏好]喜欢先画草图，再剪纸，[事实]已有一盒彩纸；[兴趣]折纸、";
    const preview = previewOnboardingMemory(ws, text, "claude", options);
    expect(preview.candidates.map((item) => [item.target, item.content])).toEqual([
      ["goal", "完成纸桥模型"],
      ["memory", "喜欢先画草图，再剪纸"],
      ["memory", "已有一盒彩纸"],
      ["memory", "折纸"],
    ]);
    for (const separator of ["，", ",", "；", ";", "、", " \t "])
      expect(
        parseMemoryPaste(`[偏好]喜欢先画草图${separator}[事实]已有彩纸${separator}`).map((item) => item.text),
      ).toEqual(["喜欢先画草图", "已有彩纸"]);
    expect(parseMemoryPaste("[没见过的类]原样内容，")[0]?.text).toBe("[没见过的类]原样内容，");
    await confirmOnboardingMemory(
      ws,
      preview.token,
      preview.candidates.map((item) => item.id),
      options,
    );
    expect(ws.readJson<{ title: string }[]>("me/goals.json").map((goal) => goal.title)).toEqual([
      "完成纸桥模型",
    ]);
    expect(
      listMemories(ws)
        .map((memory) => memory.text)
        .sort(),
    ).toEqual(["喜欢先画草图，再剪纸", "已有一盒彩纸", "折纸"].sort());
    vi.setSystemTime(new Date("2026-10-28T12:00:00+08:00"));
    const again = previewOnboardingMemory(ws, text, "claude", options);
    await confirmOnboardingMemory(
      ws,
      again.token,
      again.candidates.map((item) => item.id),
      options,
    );
    expect(ws.readJson("me/goals.json")).toHaveLength(1);
    expect(listMemories(ws)).toHaveLength(3);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  }
});

it("本地接口只确认预览中所选的记忆，整批一个版本并能撤销", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-"));
  const previousState = process.env.KAITU_LOCAL_STATE_DIR;
  process.env.KAITU_LOCAL_STATE_DIR = join(root, "state");
  const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
  const ui = await startUi(ws, { port: 0, open: false, versionDelayMs: 10 });
  const call = (method: string, args: unknown[]) =>
    fetch(`${ui.url}/api/product/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Kaitu": "1", Origin: ui.url },
      body: JSON.stringify(args),
    });
  try {
    const before = await history(ws);
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
    const ws = await clonedWorkspace("Asia/Ho_Chi_Minh", join(root, "ws"));
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
    // 跳过了一个数据源，「接上数据」就算完成，不要求每个都接上。
    expect(initial.checklist.items.find((item) => item.id === "sources")?.done).toBe(true);
    expect(initial.checklist.completed).toBe(2);
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
    expect(onboardingStatus(ws, options).checklist.completed).toBe(5);
    await confirmOnboardingSetup(ws, projectPreview.token, options);
    await confirmOnboardingSetup(ws, newsPreview.token, options);
    expect(onboardingStatus(ws, options).checklist.completed).toBe(5);
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

it("每日整理起草并归档的原文不再算等待整理，草稿仍能核对采纳；核对后只留原文也不再等待", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-organizer-notes-"));
  try {
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
    const sleep = await saveOnboardingMatter(ws, "想把入睡时间调到 11 点前");
    const original = parseFrontmatter(ws.readText(sleep.source));
    original.data.date = "2020-01-02";
    original.data.created = "2020-01-01T16:30:00Z";
    const oldSource = sleep.source;
    sleep.source = `inbox/notes/2020-01-02/${oldSource.split("/").at(-1)}`;
    ws.writeText(sleep.source, stringifyFrontmatter(original.data, original.body));
    rmSync(ws.resolve(oldSource));
    const projected = (source: string) =>
      readLibrary(ws, { section: "inbox" }).inbox.find((entry) => entry.originalSource === source);
    expect(projected(sleep.source)?.status).toBe("raw");
    const swim = await saveOnboardingMatter(ws, "想学会游泳");
    expect((await readOverviewPage(ws)).sync.received).toBe(2);
    const draft = { goal: "11 点前入睡", current: "常拖到 1 点", next: "今晚 10:30 放下手机" };
    await draftOnboardingMatter(ws, sleep.source, draft);
    const archived = await inboxNoteDone(ws, sleep.source);
    expect(projected(sleep.source)).toMatchObject({
      file: archived.path,
      originalSource: sleep.source,
      date: "2020-01-01T16:30:00Z",
      status: "review",
    });
    expect(archived.path).not.toContain("2020-01-02");
    expect(readLibrary(ws).inbox.find((entry) => entry.file === archived.path)?.status).toBe("review");
    await draftOnboardingMatter(ws, swim.source, {
      goal: "学会游泳",
      current: "不会换气",
      next: "报一节体验课",
    });
    await keepOnboardingMatter(ws, swim.source);
    expect(projected(swim.source)?.status).toBe("organized");
    expect((await readOverviewPage(ws)).sync.received).toBe(0);
    expect(readOnboardingMatter(ws, sleep.source).draft).toEqual(draft);
    await adoptOnboardingMatter(ws, sleep.source, draft);
    expect(projected(sleep.source)?.status).toBe("organized");
    expect(listTasks(ws).map((task) => task.source)).toEqual([sleep.source]);
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([false, true])("手机原文核对、采纳及只存原文保留来源，跨日归档=%s", async (archived) => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-phone-matter-"));
  try {
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
    const input = { goal: "整理手机笔记", current: "已有原文", next: "写一条摘要" };
    for (const action of ["adopt", "keep-draft", "keep-raw"]) {
      const name = `ios-3fa9c1d2-${ulid()}.note.md`;
      const source = `inbox/notes/2020-01-02/${name}`;
      const original = `合成手机原文 ${action}`;
      ws.writeText(
        `inbox/agents/${name}`,
        stringifyFrontmatter(
          {
            agent: "你（iPhone）",
            kind: "capture",
            origin: "user",
            date: "2020-01-02",
            created: "2020-01-01T16:30:00Z",
          },
          original,
        ),
      );
      await processInbox(ws, { stableMs: 0 });
      const projected = () =>
        readLibrary(ws, { section: "inbox" }).inbox.find((entry) => entry.originalSource === source);
      expect(projected()).toMatchObject({ file: source, originalSource: source, status: "raw" });
      expect(readOnboardingMatter(ws, source).text.trim()).toBe(original);
      if (action !== "keep-raw") await draftOnboardingMatter(ws, source, input);
      if (archived) {
        const result = await inboxNoteDone(ws, source);
        expect(result.path).not.toContain("2020-01-02");
        expect(projected()?.file).toBe(result.path);
      }
      if (action !== "keep-raw") {
        expect(projected()?.status).toBe("review");
        expect(readOnboardingMatter(ws, source).draft).toEqual(input);
        expect(onboardingStatus(ws, { stateRoot: join(root, "state") }).draft?.source).toBe(source);
      }
      if (action === "adopt") {
        const next = await adoptOnboardingMatter(ws, source, input);
        expect(next.source).toBe(source);
        expect(onboardingStatus(ws, { stateRoot: join(root, "state") }).next?.source).toBe(source);
        const done = await changeOnboardingNext(ws, next.id, next.rev, "complete", "写好了摘要");
        expect(done).toMatchObject({ source, status: "done", result: "写好了摘要" });
      } else {
        await keepOnboardingMatter(ws, source);
        expect(listTasks(ws, { status: "all" }).some((task) => task.source === source)).toBe(false);
      }
      expect(readOnboardingMatter(ws, source)).toMatchObject({ source, draft: null });
      expect(readOnboardingMatter(ws, source).text.trim()).toBe(original);
      expect(projected()?.status).toBe("organized");
    }
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("原文来源校验拒绝手机记录、伪文件名、错日期及越界路径，投影不暴露无效核对入口", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-capture-source-"));
  try {
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
    const name = `ios-3fa9c1d2-${ulid()}.note.md`;
    const source = `inbox/notes/2020-01-02/${name}`;
    const content = stringifyFrontmatter({ kind: "capture", date: "2020-01-02" }, "合成原文");
    ws.writeText(source, content);
    const input = { goal: "整理", current: "", next: "写摘要" };
    for (const invalid of [
      source.replace("3fa9c1d2", "not-a-device"),
      source.replace(".note.md", ".records.jsonl"),
      source.replace(".note.md", ".actions.jsonl"),
      source.replace(name, "custom.md"),
      source.replace("2020-01-02", "2020-01-03"),
      source.replace("inbox/notes/", "inbox/notes/done/"),
      source.replace("inbox/notes/", "inbox/agents/"),
      `../${source}`,
      `/${source}`,
      `${source}\n`,
      source.replace(name, `../${name}`),
      source.replaceAll("/", "\\"),
    ]) {
      expect(() => readOnboardingMatter(ws, invalid)).toThrow(expect.objectContaining({ code: "BAD_ARGS" }));
      await expect(draftOnboardingMatter(ws, invalid, input)).rejects.toMatchObject({ code: "BAD_ARGS" });
      await expect(adoptOnboardingMatter(ws, invalid, input)).rejects.toMatchObject({ code: "BAD_ARGS" });
      await expect(keepOnboardingMatter(ws, invalid)).rejects.toMatchObject({ code: "BAD_ARGS" });
    }
    const unsupported = "inbox/notes/2020-01-02/custom.md";
    ws.writeText(unsupported, content);
    expect(
      readLibrary(ws, { section: "inbox" }).inbox.find((entry) => entry.file === unsupported)?.originalSource,
    ).toBeNull();
    expect(readOnboardingMatter(ws, source)).toMatchObject({ source, draft: null });
    expect(listTasks(ws, { status: "all" })).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("原文单独保存不生成待办，AI 草稿待核对，采纳一条带来源的下一步并可记结果", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-matter-"));
  try {
    const ws = await clonedWorkspace("Asia/Ho_Chi_Minh", join(root, "ws"));
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
    // 胡志明市 10 月 18 日 0:30 完成；之后工作区改成 UTC，那一刻是 10 月 17 日。
    vi.setSystemTime(new Date("2026-10-17T17:30:00Z"));
    const done = await changeOnboardingNext(ws, next.id, later.rev, "complete", "选出了三件作品");
    expect(done).toMatchObject({
      status: "done",
      result: "选出了三件作品",
      source: matter.source,
      due: "2026-12-01",
    });
    await expect(changeOnboardingNext(ws, next.id, next.rev, "complete", "重试")).rejects.toThrow();
    // 做完的那一步只在当天留在今天顶上，第二天就不再显示；「当天」按现在的工作区时区算。
    expect(onboardingStatus(ws, { stateRoot: join(root, "state") }).next?.status).toBe("done");
    ws.writeText("me/rules.md", ws.readText("me/rules.md").replace(/^timezone:.*$/m, "timezone: UTC"));
    expect(onboardingStatus(ws, { stateRoot: join(root, "state") }).next?.status).toBe("done");
    vi.setSystemTime(Date.now() + 2 * 24 * 3600 * 1000);
    expect(onboardingStatus(ws, { stateRoot: join(root, "state") }).next).toBeNull();
    vi.useRealTimers();
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
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
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
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
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

it("旧版搬记忆挤成一条的目标和项目，启动时拆开；拆过就不再动", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-split-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
    ws.writeJson("me/goals.json", [
      {
        id: "doubao-20261019-aaaaaa",
        title:
          "投稿散文 (2026-10)[在考虑] 要不要参加老虎杯 (2026-10)，[偏好] 不爱被说教；[目标] 攒够一年生活费",
        status: "active",
      },
    ]);
    const next = await addGoalNext(ws, "doubao-20261019-aaaaaa", "这周写完初稿");
    const { slug } = await createProject(ws, {
      title: "写小说《三角梅》 [项目] 《火星安徒生》…",
      kind: "personal",
    });
    const notes = `projects/${slug}/notes.md`;
    ws.writeText(
      notes,
      `${ws.readText(notes).trimEnd()}\n\n来源：从 豆包 搬来（2026-10-19）\n\n写小说《三角梅》 [项目] 《火星安徒生》参加征文\n`,
    );

    expect(await splitImportedBlobs(ws)).toEqual({ goals: 1, projects: 1 });
    const goals = ws.readJson<{ id: string; title: string }[]>("me/goals.json");
    expect(goals.map((goal) => goal.title)).toEqual(["投稿散文", "攒够一年生活费"]);
    expect(goals[1]?.id).toMatch(/^doubao-/);
    expect(onboardingStatus(ws, options).next).toMatchObject({ id: next.id, goal: "投稿散文" });
    expect(readExploration(ws).directions.map((item) => item.title)).toContain("要不要参加老虎杯");
    expect(listMemories(ws).map((memory) => memory.text)).toContain("不爱被说教");
    expect(
      listProjects(ws)
        .map((project) => project.title)
        .sort(),
    ).toEqual(["《火星安徒生》参加征文", "写小说《三角梅》"]);
    expect(ws.readText(notes)).not.toContain("[项目]");
    expect(validateWorkspace(ws)).toEqual([]);
    expect(await splitImportedBlobs(ws)).toEqual({ goals: 0, projects: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("两个目标各有下一步：今天页卡片给还没做完的那一步，两个都能分别记结果、再定下一步", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-onboarding-two-goals-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
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
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
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
    const ws = await clonedWorkspace("Asia/Shanghai", join(root, "ws"));
    ws.writeText("me/STATUS.md", "---\nnext:\n  - 和家人吃饭\n---\n");
    expect(() => onboardingStatus(ws, options)).not.toThrow();
    expect(onboardingStatus(ws, options).draft).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
