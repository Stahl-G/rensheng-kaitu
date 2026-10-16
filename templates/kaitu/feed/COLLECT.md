# 资讯采集规则

所有采集资讯的 Agent（Grok、Dot、Codex、开图的定时任务）都按这份规则做。
本文件由开图维护，升级时更新；用户确认的关注方向在同一文件夹的 feeds.json。

## 先读

1. feed/feeds.json：keywords 是用户确认的关注方向，按它采集；muted 里的来源少采。
   keywords 为空时先请用户在「资讯 → 采集规则」填写或生成，不自行推断一份隐藏方案。
2. me/profile.md、me/goals.json、各模块 STATUS.md：判断和用户目标、项目、所在地的具体关联。
3. 提议下一版关注方向时，读 news_read 的 feedback，汇总「有用」和「不相关」。
   只提议，不直接改 keywords 或 muted；方案以关键词列表交用户在采集规则里查看差异并确认。

目标是用户不点开原文也知道发生了什么、和自己有什么关系、可以做什么。

## 新闻：news_item

| 字段 | 要求 |
|---|---|
| title、url | 必填 |
| source | 发布方名称，如「TechCrunch」；不写时开图按网址补 |
| via | 你的名字：grok、dot、codex，其他写 agent；不写时开图补 |
| summary | 事件与背景，不是重写标题；只读到标题和导语时写明「只读到标题和导语」 |
| details | 3–5 条要点 |
| comment | 1–2 句看法，用「你」对用户说，结合用户的具体情况 |
| published_at | 原文发布时间；核实不了就不写，不能用采集时间冒充 |
| relevance | ref 写具体的目标、项目或方向，reason 写实际关联，不只写模块名 |
| kind | 缺省 article；也可以是 x_post、paper、release、video、podcast |
| image | 原文封面图网址；没有图就不填，不下载 |
| sources | 同一事件的多个来源，[{name, url}] |

只有 title、url 是硬要求，其余缺了也会收下，但资讯页只能显示交了的部分，所以尽量交全。
数字、引语、作者、互动数和图片只能来自实际读到的原文；引语保留原话，不超过 60 字，放在 quote。
同一事件合并成一条，不同进展有独立事实时才另建。

## 按来源补充

- 网页：kind article，author 填署名。
- 论文：kind paper，authors 填作者数组，venue 填期刊、会议或预印本平台；分清预印本与已发表，只读摘要时写明。
- 发布：kind release，version 填实际版本，repo 可填仓库地址；不把还没发布的计划写成现有功能。
- 视频、播客：kind video 或 podcast，channel 填频道，duration 用原文时长（如 12:30）；
  highlights 用 [{time: "03:20", text: "一句话要点"}]，时间点须来自实际播放或逐字稿。
- X：只有能读取 X 的 Agent（如 Grok）采集，其他 Agent 跳过，不编造 X 内容。
  单帖用 kind x_post，必须有 post.url；post 可含 author、handle、text、url、media、likes、reposts、replies、posted_at，互动数只抄实际显示值。

## X 热门：trend

topic、via 必填；summary 写在讨论什么；samples 放代表性原帖（结构同 post）。
posts 是讨论数量，只有来源给出数量时才填，不要放原帖。
discussion 最多 3 条，每条 {stance: 观点概括, quote: 不超过 60 字的原话, who: 账号}。

## 怎么交

- 用 record_add 等记录工具新增；或在 inbox/agents/ 新建 <你的名字>-<时间>.news.jsonl，
  每行一个对象，带 type（news_item 或 trend）和 agent（你的名字），不手填 id、by、rev。
- 开图按网址给新闻去重，按本地日期和 topic 合并热门。读不出的行会附原因转成待整理笔记，原文不丢。
- 核实不了的材料写 inbox/agents/<你的名字>-<时间>.note.md。
- 采集结束前按 AGENT-README.md 新建交接记录 handoffs/<YYYYMMDDTHHMM>-<你的名字>.md，
  写明交了几条、文件名；没有新结果也写一句「今天没有新资料」，让每日整理对得上。
