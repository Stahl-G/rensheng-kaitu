# 任务：装上开图插件，dsh 里的一切自动就位（仓库级）

用户反馈：装上开图后，dsh 里的 Agent 找不到开图的技能（例如 `build-life-map`），因为 dsh 只加载会话所在项目的 `.agents/skills`，会话开在别的工作区时就看不到；另外 dsh 开着时收件箱原来不会自动处理（已在 `packages/dsh-plugin/src/inbox-loop.ts` 修好）。要求是从仓库层面一次解决：**任何新用户装上开图、打开 dsh，所有能力都自动可用**，不能靠用户手动做链接、跑命令或开别的程序。

dsh 0.2.0-rc.2 源码在 `/Users/yihongguo/Developer/deepseek-harness-rc2`（只读）。必读：`packages/skill/skill/src/index.ts`（`ctx.skills.registerProvider`、`SkillProvider` 接口）、`packages/skill/skill-filesystem`（README 与源码，看它如何解析 frontmatter、加载正文、按 scope 注册）、`packages/bundle/web-app/cordis.patch.yml` 与 `presets/*.patch.yml`（桌面版的技能注册在哪一层、preset 与 host 的关系）。开图插件在 `packages/dsh-plugin/src/index.ts`。不联网、不提交。

## 要做
1. **技能由插件注册**：开图插件用 `ctx.skills.registerProvider` 注册一个 provider，读工作区 `.agents/skills/*/SKILL.md`（工作区路径同插件 config.workspace / defaultRoot），让开图的全部技能出现在 dsh 所有会话的技能目录里，与会话的 cwd 无关。确认它注册在 host 层还是 preset 层才能被桌面版的会话看到；如果技能注册只在 preset 层生效，就在 `kaitu dsh --install` 的 patch 段里用 dsh 支持的方式把开图的 provider 加进去，并写清依据。工作区技能更新后（`kaitu upgrade`）目录能刷新。技能里的 `kaitu …` 命令在 dsh 里多半不能直接运行（用户可能没装 CLI），检查每个技能的步骤在 dsh 里能否用开图插件的工具完成；缺少的工具补上，复用 core 现有函数。
2. **排查清单**：列出「新用户只装了开图 + dsh」时，开图的每项能力在 dsh 里是否可用：技能、收件箱自动处理、给 Agent 的说明（system prompt）、记录与查询工具、每日整理与早间计划（dsh schedule）、头像与本机文件、云端接力入口文件（AGENT-README / ORGANIZER）的生成。每项写：现在可用 / 已在本次补上 / 做不到及原因。把清单写进 `docs/dsh.md` 新的一节「装上即可用」。
3. 能在本次补上的都补上，只改开图仓库，不改 dsh 源码。

## 测试
最多 1 个测试：技能 provider 在临时工作区里能列出技能并读到正文。不断言文案。

## 完成标准
`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过。中文汇报五行以内：做了什么，清单里还剩哪些做不到、依据是什么。不写免责声明。只改当前 worktree。
