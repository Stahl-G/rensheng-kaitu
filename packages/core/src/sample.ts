import fs, { readFileSync } from "node:fs";
import { join } from "node:path";
import git from "isomorphic-git";
import { assetsRoot } from "./assets.js";
import { stringifyFrontmatter } from "./frontmatter.js";
import { batchSnapshot, snapshot } from "./history.js";
import { addMemory } from "./memory.js";
import { listModules } from "./modules.js";
import { createProject, setProject, syncProject } from "./projects.js";
import { addRecords } from "./records.js";
import { isoInZone, localDate, localTimeToInstant } from "./time.js";
import { discardUpload, importUpload, stageUpload } from "./ui-imports.js";
import { validateWorkspace } from "./validate.js";
import type { Workspace } from "./workspace.js";

export async function populateSample(ws: Workspace, now = new Date()): Promise<void> {
  return batchSnapshot(ws, "添加了演示用的生活记录", () => writeSample(ws, now));
}

async function writeSample(ws: Workspace, now: Date): Promise<void> {
  const zone = ws.timeZone();
  const today = localDate(now, zone);
  const day = (offset: number) =>
    new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  const time = (date: string, hour: string) =>
    isoInZone(localTimeToInstant(`${date}T${hour}:00`, zone), zone);
  const apple = readFileSync(join(assetsRoot(), "examples/apple-health/export.xml"), "utf8");
  const nut = JSON.parse(readFileSync(join(assetsRoot(), "examples/nut-ai-backup.json"), "utf8"));
  const calendar = readFileSync(join(assetsRoot(), "examples/calendar.ics"), "utf8");
  const xml: string[] = [];
  const meals: unknown[] = [];
  const items: unknown[] = [];
  const workouts: Record<string, unknown>[] = [];
  for (let i = -29; i <= 0; i++) {
    const date = day(i);
    const healthRecord = (type: string, value: string, start: string, end?: string) => {
      const template = apple.match(new RegExp(`<Record type="${type}"[^>]+/>`))?.[0];
      if (!template) throw new Error(`缺少样例：${type}`);
      let record = template
        .replace(/value="[^"]+"/, `value="${value}"`)
        .replace(/startDate="[^"]+"/, `startDate="${start}"`);
      if (end) record = record.replace(/endDate="[^"]+"/, `endDate="${end}"`);
      xml.push(record);
    };
    healthRecord(
      "HKQuantityTypeIdentifierBodyMass",
      String((72 - (i + 29) * 0.035) / 0.45359237),
      time(date, "08:00"),
    );
    healthRecord(
      "HKQuantityTypeIdentifierBodyFatPercentage",
      String(0.205 - (i + 29) * 0.0003),
      time(date, "08:00"),
    );
    healthRecord(
      "HKQuantityTypeIdentifierStepCount",
      String(6500 + ((i + 30) % 7) * 650),
      time(date, "09:00"),
      time(date, "20:00"),
    );
    healthRecord(
      "HKQuantityTypeIdentifierBasalEnergyBurned",
      "1550",
      time(date, "00:00"),
      time(day(i + 1), "00:00"),
    );
    healthRecord(
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      String(350 + ((i + 30) % 4) * 60),
      time(date, "09:00"),
      time(date, "20:00"),
    );
    healthRecord(
      "HKCategoryTypeIdentifierSleepAnalysis",
      "HKCategoryValueSleepAnalysisAsleepCore",
      time(day(i - 1), "23:30"),
      time(date, `0${6 + ((i + 30) % 2)}:30`),
    );
    for (const [index, hour] of ["08:30", "12:30", "19:00"].entries()) {
      const id = `sample-${date}-${index}`;
      meals.push({
        ...nut.tables.meals[0],
        id,
        logged_at: +new Date(time(date, hour)),
        portion_eaten_fraction: 1,
        meal_slot: ["breakfast", "lunch", "dinner"][index],
        local_date: date,
      });
      items.push(...nut.tables.log_items.map((item: Record<string, unknown>) => ({ ...item, meal_id: id })));
    }
    if (i % 2 === 0) {
      for (const exercise of ["深蹲", "卧推"])
        workouts.push({
          ts: time(date, "18:00"),
          exercise,
          sets: 3,
          reps: 12,
          weight_kg: (exercise === "深蹲" ? 50 : 30) + Math.floor((i + 29) / 6) * 2.5,
          session_id: `sample-${date}`,
        });
    }
  }
  const buffers = [
    {
      source: "apple-health" as const,
      name: "sample.xml",
      text: `<HealthData>${xml.join("\n")}</HealthData>`,
    },
    {
      source: "nut-ai" as const,
      name: "sample.json",
      text: JSON.stringify({
        ...nut,
        tables: {
          ...nut.tables,
          meals,
          log_items: items,
          weight_entries: [],
          exercise_entries: [],
        },
      }),
    },
    {
      source: "ics" as const,
      name: "sample.ics",
      text: (() => {
        const template = calendar.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/)?.[0];
        if (!template) throw new Error("缺少日历样例");
        const events = ["项目周会", "和朋友散步", "本周回顾"].map((title, index) =>
          template
            .replace(/UID:.*/, `UID:sample-${index}`)
            .replace(
              /DTSTART[^\n]*/,
              `DTSTART:${day(index === 2 ? 2 : 0).replaceAll("-", "")}T${["090000", "140000", "160000"][index]}`,
            )
            .replace(
              /DTEND[^\n]*/,
              `DTEND:${day(index === 2 ? 2 : 0).replaceAll("-", "")}T${["100000", "150000", "170000"][index]}`,
            )
            .replace(/(?:RRULE|EXDATE)[^\n]*\n/g, "")
            .replace(/SUMMARY:.*/, `SUMMARY:${title}`),
        );
        return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Kaitu//Sample//ZH\n${events.join("\n")}\nEND:VCALENDAR`;
      })(),
    },
  ];
  for (const input of buffers) {
    const file = stageUpload(ws, input.source, input.name, Buffer.from(input.text));
    try {
      await importUpload(ws, input.source, file, false);
    } finally {
      discardUpload(ws, file);
    }
  }
  addRecords(ws, "workout", workouts, { by: "user" });
  ws.writeText(
    "NOW.md",
    stringifyFrontmatter(
      {
        date: today,
        generated_at: time(today, "07:30"),
        blocks: [
          { id: "b1", start: "09:00", end: "10:00", title: "项目周会", kind: "event", status: "confirmed" },
          { id: "b2", start: "14:00", end: "15:00", title: "和朋友散步", kind: "event", status: "confirmed" },
          {
            id: "b3",
            start: "18:00",
            end: "18:40",
            title: "腿部训练",
            kind: "proposal",
            status: "pending",
            module: "health",
            ref: "health-1",
          },
          {
            id: "b4",
            start: "20:30",
            end: "21:00",
            title: "读书半小时",
            kind: "proposal",
            status: "pending",
            module: "learning",
          },
          { id: "b5", title: "整理本周笔记", kind: "task", status: "pending" },
        ],
        attention: [{ kind: "decision", title: "选健身房：已对比 3 家，等你拍板" }],
      },
      "今天给重要的事留一点空间。训练后记得记录感受。\n",
    ),
  );
  for (const module of listModules(ws)) {
    ws.writeText(
      `${module.dir}/STATUS.md`,
      stringifyFrontmatter(
        {
          updated: time(today, "07:30"),
          progress: {
            label: module.def.name === "健康" ? "规律训练" : `${module.def.name}计划`,
            current: 3,
            target: 12,
            unit: "周",
          },
          next: [
            {
              id: `${module.dir}-1`,
              title: module.dir === "health" ? "腿部训练：深蹲 3×12" : `整理${module.def.name}本周进展`,
              priority: module.dir === "health" ? "high" : "normal",
              status: "todo",
            },
            ...(module.dir === "health"
              ? [{ id: "health-2", title: "确认下个月的体检时间", priority: "normal", status: "proposed" }]
              : []),
          ],
          blocked: [],
        },
        `${module.def.name}正在按计划推进。\n`,
      ),
    );
  }
  ws.writeText(
    "me/profile.md",
    "# 我的档案\n\n住在上海，从事产品工作。喜欢散步、读书和力量训练。\n\n目前希望把工作和生活安排得更从容，保持规律训练。\n",
  );
  ws.writeJson("me/goals.json", [
    {
      id: "g1",
      title: "连续 12 周规律训练",
      area: "health",
      priority: 1,
      status: "active",
      metric: "训练周数",
      target: "12 周",
      due: day(63),
    },
  ]);
  ws.writeJson("feed/feeds.json", {
    feeds: [{ name: "技术与生活", url: "https://example.com/feed.xml" }],
    keywords: ["人工智能", "健康", "阅读"],
  });
  ws.writeText(
    `feed/digests/${today}.md`,
    "# 今天的动态\n\n这是一份合成简报，供你熟悉工作台。\n\n## 值得关注\n\n- 技术：整理一个近期想深入了解的问题。\n- 生活：为本周留出一次不看屏幕的散步。\n",
  );
  ws.writeText(
    `reviews/daily/${today}.md`,
    "# 今天的记录\n\n早餐与午餐已记录，晚上可以对 Agent 说「复盘一下」。\n",
  );
  for (const [name, text] of [
    ["沟通方式", "喜欢简洁、具体的中文。"],
    ["训练安排", "喜欢傍晚去健身房。"],
    ["阅读", "喜欢科幻和科技类书籍。"],
    ["当前重点", "正在建立规律的生活节奏。"],
  ]) {
    await addMemory(ws, { type: "preference", name: name as string, text: text as string }, { now });
  }
  ws.writeText("sample-projects/story/manuscript/chapter.md", "# 第一章\n\n月光照亮小镇。A quiet night.\n");
  ws.writeText("sample-projects/code/README.md", "# 合成代码项目\n");
  ws.writeText("sample-projects/code/example.txt", "synthetic sample\n");
  const repo = ws.resolve("sample-projects/code");
  await git.init({ fs, dir: repo, defaultBranch: "main" });
  await git.add({ fs, dir: repo, filepath: "example.txt" });
  await git.commit({
    fs,
    dir: repo,
    message: "创建合成示例",
    author: {
      name: "Sample",
      email: "sample@localhost",
      timestamp: Math.floor(+new Date(time(day(-1), "10:00")) / 1000),
      timezoneOffset: 0,
    },
  });
  const writing = await createProject(ws, {
    title: "合成写作项目",
    kind: "personal",
    links: [
      { path: ws.resolve("sample-projects/story"), role: "manuscript", include: ["manuscript/**/*.md"] },
    ],
  });
  const coding = await createProject(ws, {
    title: "合成代码项目",
    kind: "work",
    links: [{ path: repo, role: "repo" }],
  });
  await setProject(ws, writing.slug, { next: [{ id: "story-next", title: "写完下一节", status: "todo" }] });
  await setProject(ws, coding.slug, { next: [{ id: "code-next", title: "整理示例说明", status: "todo" }] });
  await syncProject(ws, writing.slug, { now });
  await syncProject(ws, coding.slug, { now });
  const issues = validateWorkspace(ws);
  if (issues.length) throw new Error(`样例校验失败：${JSON.stringify(issues)}`);
  await snapshot(ws, "添加了演示用的生活记录", now);
}
