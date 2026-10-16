---
name: onboarding
description: 首次使用开图或用户要求重新开始时，按四步搬记忆、选事情、接数据并选择 AI。
---

# 开始使用开图

先运行 `kaitu onboarding status`。DSH 使用 `kaitu_onboarding` 的 status，MCP 可读 `onboarding_status`。
运行结果的 content 是界面与助手共用的引导内容，使用其中的 steps、ais、prompt、starts、sources、aiChoices。
先看现有 choices、sources 和 checklist，不重复询问已有资料。showGuide 为 false 时，仅在用户主动要求后重走。

1. 搬来记忆：让用户选常用 AI，展示该项 hint 与原样 prompt。收到粘贴文本后按 import-chatgpt-memory 技能预览、勾选和确认。
   也可导入 ChatGPT 对话导出包，或跳过。
2. 先管哪些：展示 content.starts，允许多选和跳过。
   用 `kaitu onboarding choose --json '<选择对象>'` 保存 seen:true、starts 和 memoryAi，固定 ID 的下一步由程序写入。
3. 接上数据：只使用 status.sources 返回的所需来源。文件导入走已有导入器的 dry-run → 确认。
   本机项目或关注方向用 `kaitu onboarding setup-preview --json '<设置对象>'`，展示返回的 input 后，确认执行 setup-confirm <token>。
   设置对象分别为 source:projects + project，或 source:news + keywords。项目至少提供一个用户指定的本机文件夹链接。
   财务复用现有财务预览。未准备好的来源存入 skipped，跳过不会计为完成。
4. 选一个 AI：展示 content.aiChoices。builtin 进入「问问」填 DeepSeek API Key，mine 进入「AI 与连接」，none 直接使用记录与导入。
   保存 aiChoice，不把选择视为实际连接。用户若要首份计划，再运行 morning-plan。

选择对象是部分更新，starts 和 skipped 传入时替换本机所选列表。重新选择不会删除已写入的下一步。
DSH 的 choose、preview、confirm、setup-preview、setup-confirm、cancel 使用同名 action。

最后再查询 status，以 checklist 交代已经有的资料、仍需接的数据和下一步。实际完成由数据计算，无须手动打勾。
不要求把每项都做完才能使用，也不把同一份资料重新导入。
