# ChatGPT 记忆贴回样例（合成）

下面模拟用户贴回的内容：

```text
[偏好] 喜欢简短、具体的中文。
[兴趣] 喜欢阅读科幻小说。
```

按 import-chatgpt-memory 技能列出两条候选，确认后将
[`chatgpt-memory-candidates.json`](chatgpt-memory-candidates.json) 复制到工作区 `inbox/memory-candidates.json`：

```sh
kaitu memory import --file inbox/memory-candidates.json --dry-run --json-out
kaitu memory import --file inbox/memory-candidates.json
kaitu history memory
```

撤销时选择导入前的版本：`kaitu restore <导入前版本> memory`。
