---
name: onboarding
description: 首次使用开图时，先保存一件事的原文，核对并采纳一个下一步，其他设置按需进行。
---

# 开始使用开图

先运行 `kaitu onboarding status`。DSH 使用 `kaitu_onboarding` 的 status，MCP 可读 `onboarding_status`。
content 是界面与助手共用的 AI 列表、记忆提示词、起步选项、数据源与 AI 选择。查看 choices、draft、next 和 checklist，避免重复导入。
showGuide 为 false 时，只在用户主动要求后重走。欢迎说明约三分钟：带来一件事，核对一个下一步，记下结果后继续推进。

默认请用户带来一段和 AI 聊过的计划，或写下正在推进的事。界面先保存到原文记录，再整理「当前目标 / 已知现状 / 一个下一步」。
已保存的原文可以用 `kaitu onboarding matter-read <source>` 读取；DSH 用 matter-read（source）。
AI 整理只生成待核对草稿：用 `kaitu onboarding matter-draft <source> --json '<草稿>'`，草稿字段为 goal、current、next，均为单行文本。
DSH 用 matter-draft（source、draft）。核对目标和已知现状，不确定的信息写明未知，只提出一个可执行的下一步。
用户在界面采纳才生成待办，来源指向原文。不要把对话里的其他建议自动写成待办；用户选择只保存原文时，到此结束。
未连接 AI 的用户可以在界面自己填写这三项，不要求先连接模型。

并列入口是「从常用的 AI 搬来记忆」。按 import-chatgpt-memory 技能预览、勾选、确认，也可导入 ChatGPT 对话导出包。

今天页的开始使用清单有六项，全部按实际数据计算：带来一件事并采纳、认识你（可选）、选事情、接数据、选 AI、第一份今天计划。
选事情、接数据、选 AI 都是可选面板，不要求做完才能使用：

- 展示 content.starts，用 `kaitu onboarding choose --json '<选择对象>'` 保存 seen:true 和 starts。固定 ID 的模块下一步由程序去重。
- 只接 status.sources 返回的数据。文件导入、财务、项目与关注方向均先预览再确认；项目/关注方向用 setup-preview、setup-confirm。
  日历用 ICS 订阅，邮件聊天打开「AI 与连接」。跳过不算完成，没有选事情时先选事情。
- builtin 进入问问设置，mine 进入「AI 与连接」继续使用原来的 AI，none 先不用。DSH 不提供内置问问。
  选择方式不等于已经连接成功。需要首份今天计划时运行 morning-plan，建议仍待确认。

最后重读 status，说明实际保存、采纳和未完成项。今天页可查看下一步的原文，完成时记一句结果，或改到以后。
选择对象为部分更新，starts 和 skipped 传入时替换本机列表；reset 只清本机选择，不删除资料，不手改完成状态或 config。
