---
name: import-chatgpt-memory
description: 当前对话出现个人事实、偏好、决定时自动记录并可撤销；AI估算和建议标明来源与不确定性。Automatically save personal changes; also import existing AI memories.
---

# 自动记下这次变化

用户自然说出的明确个人事实、偏好或决定默认自动保存，不要求再说“记住”，不逐条询问或进入审核队列。没有新变化就结束；用户说不保存、暂停或已撤销的内容不再次提交，除非用户重新要求。
不把工具回读或注入的旧记忆再次提取，不把测试材料当用户事实。不扫描历史会话、账户记忆或 transcript 文件，不上传全量对话。只取当前表达需要的最小内容。

用 `memory_capture`（DSH：`kaitu_memory_capture`）一次写一条。先查相关记忆，填 type、name、text、source、origin、observed_at、evidence、scope 和 idempotency_key。
- origin=user-stated：用户亲口说出的事实、偏好、决定；evidence 保留原话，text 保留否定、条件、时间与上下文。只对本次有依据的内容负责，不把 AI 的总结当成用户原话。
- origin=ai-estimate / ai-suggestion：可以自动记录，必须填写 uncertainty，说明依据、误差或尚未确定的条件。工具强制标为背景并带可见 AI 标签，不升级为用户事实、待办、目标或日程承诺。
- scope=temporary / quoted / hypothetical：临时要求、引用他人、假设，工具跳过长期记忆；只在当前对话使用。明确决定即使含条件也不自动等同临时要求。
- observed_at 是陈述/观察的时间，created/updated 是记录时间；事件发生时间另保留在正文。observed_at 使用实际已知的带时区时间，不把未知的“今天”猜成绝对日期；不知道来源时间时用本次记录时间，并在正文保留未知发生时间。
- idempotency_key 使用稳定的来源消息标识和条目序号。没有消息ID时用原话、来源与已知时间组成稳定标识。重试复用全部原参数，不追加新的提交时间或随机ID；撤销后重试不会复活；status=undone/superseded 表示已撤销/已更正，不能说成当前事实已保存。
- 健康、财务及其他敏感个人陈述照常自动记录并标 sensitive=true，排除共享资料包；Key、密码和私人附件不纳入。外发、共享、不可恢复删除、凭据与系统权限仍按原边界确认，宿主的安全审批照常生效，不尝试绕过。

先按实体、时间、单位和上下文消解差异：昨天82kg、今天81.5kg是变化，82kg与82000g可等价。先保留时间和单位，不笼统报冲突。
明确纠正旧说法时先回读原条，把 file 填入 replaces、原条的 type/name/text/source/sensitive 填入 expected；工具只追加新条，原文和来源留在历史中。不要用 memory_update 覆盖原话。
只有无法消解且会影响后续行为的矛盾才填 conflict，工具返回 needs-clarification 且不写入；问一个能解决当前矛盾的问题，不设提问频率或例行确认。

工具返回 entry 是从落盘文件重新读取的结果。只有 status=saved/duplicate 且 entry 未撤销才简短告知“已记下，可撤销”；读清 warning，不把 version=null 说成版本已存好。断线或结果未知，先 memory_list / memory_search 回读原条和来源，重试沿用原幂等标识。失败如实反馈，不把聊天回复当成功。
用户可在个人档案的记忆行直接点“撤销这条自动记录”或“用新说法替换”；撤销只归档该条，不恢复整个工作区，不影响后来其他资料。纠正的旧条保留；撤销新条后旧条恢复。归档记录及版本历史可回看。

`onboarding_memory_review` 只在用户明确要求逐条审阅时使用，普通自然记录不走该表单。
工具不可用时明确尚未保存，提供候选原文及开图入口，不暗示已连接或成功。Skill 的主动提取取决于当前 AI，不能保证所有外部聊天自动实时回传；不安装自动 hook 或额外调用模型。

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
