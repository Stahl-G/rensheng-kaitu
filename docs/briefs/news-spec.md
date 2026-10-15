# 任务：新闻采集规范与富内容卡片

用户反馈：资讯页只有标题，没有意义。原因是 `news_item` 只要求 title / url / source / via / status，Agent（如 Grok）只交最少字段。要定一份**两层**采集规范：所有 Agent 都适用的通用规则，加上按来源类型的补充（X 只有 Grok 能采，其他 Agent 采网页、论文、发布、视频等，不得编造 X 内容）。

## 数据（只新增可选字段，不改已有字段含义；同步 schemas/、PRD §6、AGENTS.md 与 AGENT-README 生成模板）
- `news_item` 新增 `kind`（article / x_post / paper / release / video / podcast / rss，默认 article）；按类型的可选字段：article 的 `author`、`quote`（≤ 60 字原文引语）；paper 的 `authors`、`venue`；release 的 `repo`、`version`；video / podcast 的 `channel`、`duration`、`highlights`（时间点 + 一句话）；同一事件多个来源时用 `sources`（[{name, url}]）合并。另外新增：`details`（3–5 条要点，字符串数组）、`post`（X 原帖：author、handle、text、url、media[]（图片 URL）、likes、reposts、replies、posted_at）、`discussion`（数组，每条 {stance 观点概括, quote 短原话 ≤ 60 字, who 账号}，最多 3 条）、`comment`（Agent 的看法，1–2 句，单独标为 AI 分析）。`image` 继续表示封面图。
- `trend` 新增：`summary`、`posts`（改名冲突时用 `samples`：代表性原帖数组，结构同 `post`）、`discussion`。
- 校验（通用）：`via` 不是 rss / user 时，`summary`、`details`、`comment`、`published_at` 必填；读不到全文时摘要须注明「只读到标题和导语」。按类型：x_post 必须有 `post.url`；release 必须有 `version`；paper 必须有 `authors`。不合格的行按现有规则转「待整理」，并在笔记里写明缺了什么。图片只存 URL，不下载。

## 技能与说明
- 新技能 `collect-news`（templates/kaitu/.agents/skills/）分两部分：**通用规则**（所有 Agent：必填项、真实性——数字、引语、图片只能来自原文，没有图就不填，看法与事实分开，读不到全文要注明；同一事件合并；投递格式 *.news.jsonl 或 records.jsonl）和**按来源补充**（网页、论文、发布、视频/播客、X）。X 一节注明「只有能读取 X 的 Agent（如 Grok）采集；其他 Agent 跳过，不得编造」，X 热门写成 trend。
- AGENT-README 的资讯投递说明指向这个技能；`docs/` 里更新给 Grok 的每日采集指令（06:47）：按 collect-news 采 5 条 AI、5 条用户相关综合、约 10 条 X 热门。

## 页面（packages/dsh-plugin 资讯页）
- 卡片：左侧封面图（没有图时用来源图标占位），右侧标题 + 摘要 + 来源。
- 点开展开：要点列表 → X 原帖卡片（头像首字母、作者、账号、原文、图片网格、点赞/转发/回复、时间、原帖链接）→ 讨论（观点 + 短原话）→「开图的看法」（标 AI 分析）。
- 「X 热门」：图卡网格，点开看代表性原帖和讨论。
- 设计语言照 `docs/design/news.dc.html` 和现有资讯页；外链图片加载失败时退回占位，不留空白。

## 测试
最多 2 个：缺摘要的 Agent 新闻被退回并写明原因；带 post 的新闻在 Remote 数据里完整返回。

## 完成标准
`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过。中文汇报三行以内，不写免责声明。
