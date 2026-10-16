---
name: collect-news
description: 为开图采集新闻、论文、发布、视频播客与 X 热门，按来源核实后投递富内容记录。
---

# 采集资讯

## 通用规则（所有 Agent）

先读 me/profile.md、me/goals.json、各模块 STATUS.md 与 feed/feeds.json，按用户目标、项目、所在地和关注点筛选。
feed/feeds.json 的 keywords 包含用户标记有用的来源，后续优先采集；muted 是用户不相关反馈，减少这类来源。
让用户不必点开原文也能理解发生了什么、为什么相关、可做什么。记录字段以工作区 schema 为准。

- news_item 保留 title、url、source、via、status。kind 缺省 article，可选 x_post、paper、release、video、podcast、rss。
- Agent 采集（via 非 rss/user）必须交 summary、details（3–5 条要点）、comment（1–2 句看法）、published_at（原文发布时间）。
  summary 概括事件与背景，relevance.ref 写具体目标、项目或方向，reason 解释实际关联，不只写模块名。
  comment 用第二人称对用户说「你」，结合用户的具体情况点评。
- 读原文后再写。读不到全文时 summary 明确注明「只读到标题和导语」，只概括实际读到的内容。
  发布时间无法核实时写待整理笔记，不能用采集时间冒充。
- 数字、引语、作者、互动数和图片只能来自实际读到的原文。引语保留原话且不超过 60 字，不把转述放进 quote。
  没有图就不填 image。image 是封面图，post.media 是原帖图片 URL 数组，均只存 URL，不下载。
- 同一事件合并成一条，sources 用 [{name, url}] 列明多个来源，包含已有记录的原文链接供去重。
  不同进展有独立事实时才另建新闻。
- 用现有记录工具新增，或交 inbox/agents/<唯一名>.news.jsonl / <唯一名>.records.jsonl。
  每行一个对象，带 type（news_item 或 trend）、agent（你的稳定名称），以换行结束；不手填 id/by/rev。
  不合格行会附缺失原因转入待整理笔记，补齐后以新文件重交。无法核实的材料直接写 *.note.md。

## 按来源补充

### 网页

kind: article。读取发布者原文，author 填署名；quote 可选，最多 60 字原话。
summary 与 details 说明事件、背景、关键影响，避免重写标题充当摘要。

### 论文

kind: paper，authors 必填非空作者数组，venue 填实际期刊/会议或预印本平台。
区分预印本与已发表，说明研究问题、方法、结果与限制，只读摘要时明确读取范围。

### 发布

kind: release，version 必填实际版本，repo 可填仓库地址。
读发布说明，交代新增能力、适用人群和升级影响；不将尚未发布的计划写成现有功能。

### 视频 / 播客

kind: video 或 podcast。channel 填频道，duration 用原文时长（如 12:30）。
highlights 用 [{time: "03:20", text: "一句话要点"}]；时间点须来自实际播放或逐字稿，不凭标题猜内容。

### X

只有能读取 X 的 Agent（如 Grok）采集；其他 Agent 跳过，不得编造 X 内容。
单帖用 kind: x_post，必须有 post.url。post 可含 author、handle、text、url、media、likes、reposts、replies、posted_at。
原帖正文保持原文，互动数只抄实际显示值，没有就省略。
X 热门写 trend：topic、via、summary、samples（代表性原帖数组，结构同 post）、discussion。
trend.posts 已表示讨论数量，不能改成原帖数组；只有真实来源给出数量时才填写。
discussion 最多 3 条，每条 {stance: 观点概括, quote: 不超过60字的短原话, who: 账号}，只摘实际读到的讨论。
