export const INBOX_FORMATS = `后缀写不准也能收：.json / .jsonl 按内容识别成记录、记忆或日程建议，.md / .txt 当笔记；多写的字段会被忽略。写法不对的整行转成待整理笔记并写明原因。
- <唯一名>.md 或 .note.md：任意自然语言，frontmatter 可选 agent、date。
- <唯一名>.news.jsonl：资讯投递，行格式同 records.jsonl，按 feed/COLLECT.md 采集。
- <唯一名>.records.jsonl：每行一个对象，以换行结束。type 选择下面的记录类型，agent 可选，填你的稳定名称。
  要修改或撤回之前交过的一份记录文件：放一份新文件，第一行写 {"replaces": "之前的文件名"}，后面写改好的全部记录；只写这一行就是撤回。只能替换你自己交的文件。
- <唯一名>.digest.md：正文 Markdown；frontmatter 可写 date（YYYY-MM-DD，不写时取文件名里的日期或当天）和 agent。同日按 agent 分节合并，同源重交替换自己的部分。
  示例：
\`\`\`md
---
date: "2026-10-15"
agent: example-bot
---
今天的动态简报。
\`\`\`
- <唯一名>.memory.json：数组。每项写 type（preference / fact / context / person / decision）和 text；name 不写时取正文开头；可选 source、sensitive、agent。
  示例：\`[{"type":"preference","name":"训练时间","text":"喜欢晚间训练","agent":"example-bot"}]\`
- <唯一名>.proposal.json：对象，写 title、start、end（HH:MM，如 18:00，结束须晚于开始）；可选 module、agent。用于今天的待确认建议。
  示例：\`{"title":"散步","start":"18:00","end":"18:30","module":"health","agent":"example-bot"}\`
`;
