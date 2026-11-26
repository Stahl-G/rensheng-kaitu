import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parseFrontmatter, readUserPage, refreshOverview, renderAgentReadme } from "../src/index.js";
import { clonedWorkspace } from "./helpers.js";

const page = (lines: string[]) =>
  [
    "## 用户近况",
    "",
    "### 我是谁",
    "",
    ...lines,
    "",
    "用户近况到此结束。需要细节再按 AGENTS.md 查原文。",
    "",
    "## 昨天做了什么",
    "",
    "- 合成进展",
    "",
  ].join("\n");

const daily = (date: string, body: string) => `---\norganizer: muse\ndate: ${date}\n---\n${body}`;

it("整理员只新建每日整理时，电脑把其中的用户近况复制成 USER.md，并在入口写明能否直接读", async () => {
  const ws = await clonedWorkspace();
  ws.writeText(
    "handoffs/daily/2026-10-15.md",
    daily(
      "2026-10-15",
      page([
        "- 写小说，详见me/profile.md里的档案",
        "- 插件在 `0.2.3-alpha.2`",
        "- 早/午/晚各记一次，见 https://example.com/docs/a",
      ]),
    ),
  );
  const now = new Date("2026-10-15T12:00:00+08:00");
  refreshOverview(ws, now);
  const user = parseFrontmatter(ws.readText("USER.md"));
  expect(user.data).toEqual({ organizer: "muse", date: "2026-10-15" });
  expect(user.body).toMatch(/^# 用户近况\n\n## 我是谁\n\n- 写小说，详见me\/profile\.md里的档案\n/);
  expect(user.body).not.toContain("昨天做了什么");
  const line = "先读 `USER.md`：muse 在 2026-10-15 写的用户近况，电脑已核对。";
  expect(ws.readText("OVERVIEW.md")).toContain(line);
  expect(renderAgentReadme(ws, now, readUserPage(ws, now))).toContain(line);

  ws.writeText("USER.md", `${ws.readText("USER.md")}整理员直接改的一行\n`);
  refreshOverview(ws, new Date("2026-10-18T12:00:00+08:00"));
  expect(ws.readText("USER.md")).toContain("整理员直接改的一行");
  expect(ws.readText("OVERVIEW.md")).toContain("muse 在 2026-10-15 写的，已超过一天");
});

it("近况引用不对外的资料或没写完时不复制，旧的程序画像也不算通过，读者改读正本", async () => {
  const ws = await clonedWorkspace();
  const legacy = "# 用户画像\n\n电脑生成的旧画像…（节选，须回读）\n";
  ws.writeText("USER.md", legacy);
  const now = new Date("2026-10-15T12:00:00+08:00");
  refreshOverview(ws, now);
  expect(ws.readText("OVERVIEW.md")).toContain(
    "`USER.md` 未通过核对（frontmatter 缺 organizer 或 date）：改读 `me/goals.json`",
  );

  ws.writeText("learning/topic/notes.md", "# 主题\n");
  const leaky = page([
    "- 体重见 health/data/2026-10.jsonl",
    "- 账户见finance/账户.json",
    "- 笔记见 `learning/沟通 笔记/notes.md`",
    "- 明细见 `finance/accounts.json#account-1`",
    "- 照片见 health/files/photos/2026-10-01.jpg",
    "- 睡眠见 ./health/data/2026-09.jsonl",
    "- 原始记录在 health/data",
    "- 照片都在health/files里",
    "- 密钥见 `secrets.json`",
    "- 另见 missing.md",
    "- 主题在 learning/topic2",
    "- 报告在 `/mnt/personal/report.pdf`",
  ]);
  ws.writeText("handoffs/daily/2026-10-15.md", daily("2026-10-15", leaky.replace("用户近况到此结束", "")));
  refreshOverview(ws, now);
  expect(ws.readText("USER.md")).toBe(legacy);
  const overview = ws.readText("OVERVIEW.md");
  for (const problem of [
    "缺少结尾一行",
    "写了本机绝对路径",
    "引用了不对外的 health/data/2026-10.jsonl",
    "引用了不对外的 finance/账户.json",
    "引用的 learning/沟通 笔记/notes.md 不存在",
    "引用了不对外的 finance/accounts.json",
    "引用了不对外的 health/files/photos/2026-10-01.jpg",
    "引用了不对外的 health/data/2026-09.jsonl",
    "引用了不对外的 secrets.json",
    "引用的 missing.md 不存在",
    "引用的 learning/topic2 不存在",
  ])
    expect(overview).toContain(problem);
  expect(overview).toMatch(/引用了不对外的 health\/data[；）]/);
  expect(overview).toMatch(/引用了不对外的 health\/files[；）]/);
  expect(overview).toContain("：改读 `me/goals.json`、`me/profile.md` 与 `memory/MEMORY.md`。");

  rmSync(join(ws.root, "USER.md"));
  mkdirSync(join(ws.root, "USER.md"));
  ws.writeText("handoffs/daily/2026-10-16.md", daily("2026-10-16", page(["- 写小说"])));
  refreshOverview(ws, now);
  expect(ws.readText("OVERVIEW.md")).toContain("`USER.md` 未通过核对（无法读取）：改读");
});
