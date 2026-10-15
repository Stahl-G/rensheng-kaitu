export const INBOX_FORMATS = `- <唯一名>.note.md：任意自然语言，frontmatter 可选 agent、date。
- <唯一名>.news.jsonl：资讯投递，行格式同 records.jsonl，按 .agents/skills/collect-news/SKILL.md 采集。
- <唯一名>.records.jsonl：每行一个对象，以换行结束。type 选择下面的记录类型，agent 可选，填你的稳定名称。
- <唯一名>.digest.md：frontmatter 必填 date（YYYY-MM-DD），可选 agent；正文 Markdown。同日按 agent 分节合并，同源重交替换自己的部分。
  示例：
\`\`\`md
---
date: "2026-10-15"
agent: example-bot
---
今天的动态简报。
\`\`\`
- <唯一名>.memory.json：非空数组。每项必填 type（preference / fact / context / person / decision）、name、text（非空字符串）；可选 source（字符串）、sensitive（布尔）、agent（字符串）。
  示例：\`[{"type":"preference","name":"训练时间","text":"喜欢晚间训练","agent":"example-bot"}]\`
- <唯一名>.proposal.json：对象，必填 title（字符串）、start、end（HH:mm，结束可为 24:00，须晚于开始）；可选 module、agent（字符串）。用于今天的待确认建议。
  示例：\`{"title":"散步","start":"18:00","end":"18:30","module":"health","agent":"example-bot"}\`
`;
