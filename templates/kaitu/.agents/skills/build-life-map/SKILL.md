---
name: build-life-map
description: 从用户记忆、档案或对话重建城市级人生地图，区分真实经历与计划。
---

# 从记忆建立人生地图

读取 memory/MEMORY.md、相关 memory/ 条目与 me/profile.md，需要时检索 chats/ 原文。
只提取属于用户本人的明确居住、工作、求学、旅行或到访。小说、转述他人、假设不写入。
用户自述用 user_reported；「想去」「准备去」用 planned，不把计划变成到访。

先从个人档案、记忆和相关对话识别家乡，引用用户自己的成长经历或明确陈述。
家乡与出生地、籍贯、当前居住地分别理解，不拿最早城市记录代替。没有依据时不猜。
在 me/profile.md 的基本情况中维护一条「家乡：城市名」，保留原文依据路径在附近；
模型仅能间接推断时先写「家乡（待核对）：城市名」，向用户说明依据并核对后再改为「家乡：城市名」。
遇到多候选或冲突先问用户，不写多个确定家乡。更新时保留档案其他内容及既有确认规则。
城市名使用 place_resolve 可唯一定位的名称；家乡不补造出生时间或居住经历。

通过 MCP experience_add 批量提交，或使用 dsh kaitu_add_experience。
每条提供 place（name 与可选 country 国家代码）、event_type、fact_status、time_precision、source 原文路径。
有依据才填 start、end，保留年、月、日精度，未知时间不填，time_precision 用 unknown。
只给城市名与国家代码，坐标和 geonameid 由工具解析。同城不同时间的经历分别提交。
工具不可用时向 inbox/agents/ 新建 *.records.jsonl，每行 type 为 experience，其他字段相同。

调用 life_map 回读新增数、待核对经历与来源，歧义交给用户选择，不凭人口之外的猜测代选。
批量导入沿用工作区确认规则，写入结果与版本以工具回执为准。
