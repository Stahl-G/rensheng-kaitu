---
name: import-chatgpt-memory
description: 用户说“记住这次变化”或当前对话出现明确的新事实、偏好、决定时，主动把本次变化送开图预览，由用户确认后保存；也用于从常用 AI 搬来记忆。Remember this change, review and confirm memories.
---

# 记住这次变化

用户只需说「记住这次变化」。当前对话出现用户明确的新事实、偏好或决定时，主动使用本技能准备候选；用户说不保存或已取消的内容，不再次提交，除非用户重新要求。
没有新变化就结束。不扫描历史会话、账户记忆或 transcript 文件，不上传全量对话。

只选用户亲口说出或逐条明确认可的内容。保留原话中的否定、条件、暂时性、日期及来源；不知道的时间留作未知，不把“今天”猜成绝对日期。
AI 的推断、建议、测试文本、引用他人的话、假设和未决选项不能当作用户事实；需要时只提问，得到回答后再做候选。
健康、财务等敏感内容仅在用户明确要求保存该内容时纳入；不提交 Key、密码或私人附件。
每行用现有 `[事实]`、`[偏好]`、`[决定]` 标签，加用户原话以及已知的对话日期、来源说明；不另造数据格式。
重试沿用同一段候选文字，不追加新的提交时间。已有记忆的变化作为有时间限定的新记忆，不静默覆盖旧条目。

先读 `onboarding_status` 的 content.ais 选择真实来源；不在列表的运行时用 other，在候选正文说明已知来源，不冒充 ChatGPT 或 Claude。
有 `onboarding_memory_review` 时，把候选 text、来源 ai 和界面语言 locale 交给它。它复用开图搬记忆预览、去重与版本逻辑，向用户显示原话，让用户勾选并确认。
用普通话说明「这几条还没保存，请核对后选择要记住的变化」；不向用户展示协议、token 或内部行号。面向英文用户用英文说明，原话不翻译。
**模型不能代填确认表单、自动 accept，也不能用 memory_save、record_add、memory import、文件写入或 CLI confirm 替代这一确认。**
用户取消、空选或确认能力不足时说明尚未保存，不换写入入口凑成功。确认后遇到断线、权限错误或丢失回执时，说明保存结果尚未核实，先回读记忆和来源，不宣称成功或直接重试。预览过期须重新展示，让用户重新选择；旧选择不自动复用。
只有返回 entries 才说明实际保存的条数和来源；空 candidates 表示没有新增，取消表示未保存。返回的 version / before 留作回读与撤销依据，不把无回执当成功。
确认后可用 memory_list / memory_search 回读正文与来源；用户要撤销时在开图历史中恢复 before 对应的导入前版本，先说明整批恢复会影响其后的改动，不自动恢复。

没有工具或客户端不支持确认表单时：提供可复制的候选文本，让用户到开图「从常用的 AI 搬来记忆」选择来源、粘贴、预览并确认。明确「尚未保存」，不要求普通用户运行命令。
Skill 是使用指引，不是权限隔离；是否主动调用由当前 AI 决定。不承诺 ChatGPT、Gemini、Claude 的所有聊天自动实时回传。

## 搬来已有记忆

搬记忆是首次使用的并列入口，也可从今天页的「让开图认识你（可选）」进入，不阻挡保存一件事并采纳下一步。

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

只有用户看过候选并明确选中确认后才能执行上述 confirm；“帮我搬来”不等于已确认每条。报告实际写入的 entries、goals、projects、directions 数量和所选 AI 的来源，不把全部候选数当作已保存。
需要撤销时，用返回的 before 在历史中恢复整批导入前版本。
对话导出包另走既有 chatgpt-conversations 导入预览，不把导入对话等同于已保存记忆。
