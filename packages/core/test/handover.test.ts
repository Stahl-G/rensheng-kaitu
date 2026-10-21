import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  addGoalNext,
  addMemory,
  addRecord,
  addTask,
  adoptOnboardingMatter,
  changeOnboardingNext,
  confirmOnboardingMemory,
  directionsPrompt,
  handoverPack,
  initWorkspace,
  onboardingStatus,
  parseMatterAnswer,
  pasteDirections,
  pasteOnboardingMatter,
  previewOnboardingMemory,
  readExploration,
  readLibrary,
  readOverviewPage,
  saveOnboardingMatter,
  updateRecord,
  validateWorkspace,
} from "../src/index.js";

it("长篇 AI 方向贴回后正文简短可读，定位符不进入正文，参考链接仍可追溯", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-direction-copy-"));
  try {
    const ws = await initWorkspace(join(root, "workspace"), { timeZone: "Asia/Shanghai" });
    const answer = JSON.stringify([
      {
        title: "试一次周末摄影",
        motivation: `你喜欢散步。projects/abcdef123456/notes.md 和 /Users/example/Documents/private.md 记录过这个兴趣。${"从身边的小事开始。".repeat(80)}`,
        hypothesis:
          "这周末用手机拍三张照片，每周保留 2/3 次散步时间，看看是否愿意继续。https://example.org/papers/0123456789abcdef",
        references: [{ kind: "source", ref: "https://example.org/photography" }],
      },
    ]);
    const result = await pasteDirections(ws, answer);
    const saved = readExploration(ws).directions.find((item) => item.id === result.ids[0]);
    expect(saved?.title).toBe("试一次周末摄影");
    expect(saved?.motivation.length).toBeLessThan(250);
    expect(saved?.motivation).toContain("你喜欢散步");
    expect(saved?.motivation).not.toContain("abcdef123456");
    expect(saved?.motivation).not.toContain("/Users/");
    expect(saved?.hypothesis).toBe("这周末用手机拍三张照片，每周保留 2/3 次散步时间，看看是否愿意继续。");
    expect(saved?.references).toEqual([{ kind: "source", ref: "https://example.org/photography" }]);
    expect(await pasteDirections(ws, answer)).toEqual({ ids: [], skipped: 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("贴回自己 AI 的回答：标签行、英文路径和 JSON 都读成待核对草稿，缺项说明原因", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-clipboard-"));
  const options = { stateRoot: join(root, "state") };
  try {
    expect(
      parseMatterAnswer(
        "好的，整理如下：\n```\n【目标】三个月内转岗做产品\n【现状】做了四年运营，\n还没有作品集\n【下一步】这周写一份产品分析\n```\n祝顺利！",
      ),
    ).toEqual({
      goal: "三个月内转岗做产品",
      current: "做了四年运营， 还没有作品集",
      next: "这周写一份产品分析",
    });
    expect(
      parseMatterAnswer(
        "[Goal] Find work I enjoy\n[Now] Four years in ops, unsure\n[Path] Product | uses ops skills | which domain | shadow a PM for a day\n[Path] Research | likes depth | pay | write one study outline",
        "en",
      ),
    ).toMatchObject({
      goal: "Find work I enjoy",
      next: "",
      paths: [{ name: "Product" }, { name: "Research" }],
    });
    expect(parseMatterAnswer('{"goal":"跑完半马","current":"能跑 5 公里","next":"周六跑 8 公里"}').next).toBe(
      "周六跑 8 公里",
    );
    expect(() => parseMatterAnswer("【现状】只有现状")).toThrow("目标");
    expect(() => parseMatterAnswer("[Goal] x\n[Path] only one part", "en")).toThrow("[Path]");
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    const matter = await saveOnboardingMatter(ws, "想每周练三次，但总坚持不了两周。");
    const draft = await pasteOnboardingMatter(
      ws,
      matter.source,
      "【目标】每周稳定练三次\n【现状】最长坚持过两周\n【下一步】周二晚上先练 20 分钟",
      options,
    );
    expect(draft.draft).toMatchObject({ goal: "每周稳定练三次", next: "周二晚上先练 20 分钟" });
    // 剪贴板不算连接 AI，「开始使用」里仍提示去连。
    expect(onboardingStatus(ws, options).checklist.items.find((item) => item.id === "ai")?.done).toBe(false);
    const next = await adoptOnboardingMatter(ws, matter.source, draft.draft as never);
    expect(next.goal).toBe("每周稳定练三次");
    expect(
      readLibrary(ws, { section: "inbox" }).inbox.find((entry) =>
        entry.file.endsWith(matter.source.split("/").at(-1) ?? ""),
      ),
    ).toMatchObject({
      status: "organized",
    });
    const source = matter.source.split("/").at(-1) as string;
    expect((await readOverviewPage(ws)).plans.sources[source]).toMatchObject({
      taskId: next.id,
      title: "周二晚上先练 20 分钟",
      goalTitle: "每周稳定练三次",
    });
    updateRecord(ws, "task", next.id, { title: "周二先练 25 分钟" }, { by: "user" });
    expect((await readOverviewPage(ws)).plans.sources[source]?.title).toBe("周二先练 25 分钟");
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("资料包只带目标、结果、下一步和非敏感记忆；方向建议贴回后待采纳且不重复", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-handover-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    const preview = previewOnboardingMemory(
      ws,
      "[目标] 半年内跑完半马\n[偏好] 喜欢早上运动",
      "claude",
      options,
    );
    await confirmOnboardingMemory(ws, preview.token, ["line-1", "line-2"], options);
    await addMemory(ws, { type: "fact", name: "secret", text: "合成敏感事实 X9", sensitive: true });
    await addMemory(ws, { type: "person", name: "friend", text: "朋友小周在杭州" });
    addRecord(
      ws,
      "meal",
      { meal: "午", items: [{ name: "合成午餐 Q7" }], kcal: 500, protein_g: 25, source: "synthetic" },
      { by: "user" },
    );
    const goal = (await readOverviewPage(ws)).plans.goals[0]?.id as string;
    const next = await addGoalNext(ws, goal, "周六跑 8 公里");
    await changeOnboardingNext(ws, next.id, next.rev, "complete", "跑完 8 公里，膝盖没事");
    await addGoalNext(ws, goal, "下周六跑 10 公里");
    const pack = handoverPack(ws, "zh-CN");
    expect(pack.text).toContain("半年内跑完半马（从 Claude 搬来");
    expect(pack.text).toContain("跑完 8 公里，膝盖没事");
    expect(pack.text).toMatch(/） · 下一步：下周六跑 10 公里/);
    expect(pack.text).toContain("喜欢早上运动");
    expect(pack.text).toContain("【目标】");
    for (const hidden of ["合成敏感事实 X9", "合成午餐 Q7", "朋友小周", ws.root])
      expect(pack.text).not.toContain(hidden);
    expect(pack.sections.find((section) => section.id === "people")).toMatchObject({ defaultOn: false });
    expect(handoverPack(ws, "en").text).toContain("Goals I'm working on");
    expect(handoverPack(ws, "en").text).toMatch(/\) · next: 下周六跑 10 公里/);
    expect(directionsPrompt(ws, "zh-CN")).toContain("半年内跑完半马");
    const answer = [
      "【方向】试试越野跑",
      "【为什么适合】喜欢早上运动；越野跑社群 2026 年在增长",
      "【假设】周末一次短途越野会更容易坚持。小实验：这周末跑 5 公里山路，看是否想再去",
      "【还不清楚】附近有没有安全路线",
      "【来源】https://example.org/trail-2026",
      "",
      "【方向】加入跑团",
      "【为什么适合】有人一起更能坚持",
    ].join("\n");
    const first = await pasteDirections(ws, answer, options);
    expect(first.ids).toHaveLength(2);
    const directions = readExploration(ws).directions.filter((item) => first.ids.includes(item.id));
    expect(directions.every((item) => item.status === "suggested")).toBe(true);
    expect(onboardingStatus(ws, options).checklist.items.find((item) => item.id === "ai")?.done).toBe(false);
    expect(directions.find((item) => item.title === "试试越野跑")?.references).toEqual([
      { kind: "source", ref: "https://example.org/trail-2026" },
    ]);
    expect(await pasteDirections(ws, answer, options)).toEqual({ ids: [], skipped: 2 });
    await expect(pasteDirections(ws, "随便聊聊", options)).rejects.toThrow("方向");
    expect(validateWorkspace(ws)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("普通记忆里写着 Key 或本机路径时，资料包和方向提示词都去掉它们，其余内容照常带上", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-redact-"));
  const options = { stateRoot: join(root, "state") };
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    const secrets = [
      "sk-proj-SyntheticKey0123456789abcdef",
      "Hunter2!synthetic",
      "/Users/synthetic/Customers/private.csv",
      "Json$ecret42",
      "Plain$ecret42",
    ];
    const preview = previewOnboardingMemory(
      ws,
      [
        `[事实] 我的 OpenAI key 是 ${secrets[0]}`,
        `[事实] 数据库密码是 ${secrets[1]}`,
        `[事实] 客户名单在 ${secrets[2]} 里`,
        `[事实] 配置 {"password":"${secrets[3]}"}`,
        `[事实] My password is ${secrets[4]}`,
        "[偏好] 喜欢早上运动",
        "[目标] 半年内跑完半马",
      ].join("\n"),
      "chatgpt",
      options,
    );
    await confirmOnboardingMemory(
      ws,
      preview.token,
      preview.candidates.map((item) => item.id),
      options,
    );
    const pack = handoverPack(ws, "zh-CN");
    const outbound = [
      pack.text,
      directionsPrompt(ws, "zh-CN"),
      ...pack.sections.flatMap((section) => section.lines),
    ];
    for (const text of outbound) for (const secret of secrets) expect(text).not.toContain(secret);
    expect(pack.text).toContain("（密钥已去掉）");
    expect(pack.text).toContain("客户名单在 （本机路径已去掉） 里");
    expect(pack.text).toContain("喜欢早上运动");
    expect(handoverPack(ws, "en").text).toContain("(key removed)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("最近 30 天的结果按完成时间算：两个月前定下、今天完成的一步也算，按完成先后排列", async () => {
  const root = mkdtempSync(join(tmpdir(), "kaitu-results-"));
  try {
    const ws = await initWorkspace(join(root, "ws"), { timeZone: "Asia/Shanghai" });
    ws.writeJson("me/goals.json", [
      { id: "note-20260801-abc123", title: "半年内跑完半马", status: "active" },
    ]);
    const step = (title: string, now: Date) =>
      addTask(
        ws,
        {
          title,
          source: "me/goals.json#note-20260801-abc123",
          notes: "当前目标：半年内跑完半马\n已知现状：\n目标编号：note-20260801-abc123\n",
        },
        { now },
      );
    const early = (await step("先跑 5 公里", new Date(Date.now() - 60 * 86400000))).record;
    const fresh = (await step("再跑 8 公里", new Date())).record;
    await changeOnboardingNext(ws, fresh.id, fresh.rev ?? 1, "complete", "8 公里跑完了");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await changeOnboardingNext(ws, early.id, early.rev ?? 1, "complete", "5 公里补跑完了");
    const results = handoverPack(ws, "zh-CN").sections.find((section) => section.id === "results")?.lines;
    expect(results).toEqual(["- 先跑 5 公里：5 公里补跑完了", "- 再跑 8 公里：8 公里跑完了"]);
    expect((await readOverviewPage(ws)).plans.goals[0]).toMatchObject({
      results: 2,
      lastResult: "5 公里补跑完了",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
