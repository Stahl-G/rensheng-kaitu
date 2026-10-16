# Grok 每日采集指令（06:47）

在用户设置的时区每天 06:47 执行：

> 打开开图工作区，先读 AGENT-README.md，再读 feed/COLLECT.md（资讯采集规则）和 feed/feeds.json（关注方向）。
> 围绕已确认的关注方向采集近期新闻和 X 热门，结合档案、目标和项目判断关联，只交有实际关联的新资料；没有关注方向时先请用户设置。同一事件合并，不凑数。
> 新闻用 news_item：title、url 必交，尽量写 summary、3–5 条 details、给用户的 comment、原文 published_at 和 relevance；X 热门用 trend，附 samples 原帖与 discussion。
> 数字、引语、图片与互动数只用实际读到的原文；读不到全文写明「只读到标题和导语」。
> 投递 inbox/agents/<你的名字>-<时间>.news.jsonl；结束前按 AGENT-README 留交接记录，没有新结果也写一句。

本文件是定时任务指令文本，时间沿用用户设置。采集规则只改 feed/COLLECT.md，这段指令不用跟着改。
