---
name: import-chatgpt-memory
description: 从 ChatGPT 或其他常用 AI 搬来记忆时，使用共用内容预览、选择并整批确认写入。
---

# 从常用 AI 搬来记忆

读取 `kaitu onboarding status` 返回的 content，选择 ais 中的来源，展示对应 hint 和 prompt。
DSH 用 `kaitu_onboarding` 的 status，MCP 可用 `onboarding_status` 读内容。
提示词、AI 列表和记忆位置提示以这份结果为准，不在技能内维护副本。

用户粘贴回答后，将原文放在本机临时文本文件，运行：

```sh
kaitu onboarding preview --file <本机临时文本> --source <AI的id>
```

展示返回的 candidates，按 category 分组。用户可以取消任意条目。
格式没对上的行已经原样保留，时间已保留在正文里，不自行删掉或按目标、规则重新分流。
预览已与现有记忆和本批去重。任何进一步整理、改规则或目标是后续单独操作。

用户确认后，把所选 id 传给同一个 token：

```sh
kaitu onboarding confirm <token> --json '{"selected":["line-1","line-3"]}'
```

DSH 对应 `kaitu_onboarding` 的 preview（text、ai）、confirm（token、selected）和 cancel（token）。
预览已过期时重新展示，不用旧选择盲目提交。放弃用 `kaitu onboarding cancel <token>`，结束后删除本机临时文本。

报告返回的 entries 数量、所选 AI 的来源和 version。
需要撤销时，用返回的 before 在历史中恢复整批导入前版本。
对话导出包另走既有 chatgpt-conversations 导入预览，不把导入对话等同于已保存记忆。
