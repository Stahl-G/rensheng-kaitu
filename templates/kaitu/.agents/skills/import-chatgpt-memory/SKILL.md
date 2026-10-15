---
name: import-chatgpt-memory
description: 用户要导入 ChatGPT 记忆或贴回记忆列表时，分流候选并整批确认导入。
---

# 导入 ChatGPT 记忆

## 步骤

1. 给用户下面的提示词，请其在 ChatGPT 中发送并贴回结果：
```text
请把你记住的关于我的所有信息完整列出来，尽量保持原文，不要总结或省略。包括：
1. 你保存的记忆条目
2. 我设置的自定义指令或个性化偏好
3. 你从我们的对话里了解到的我的情况：工作、目标、健康、作息、兴趣、正在做的项目、重要的人
按下面的格式输出，每条一行：
[类别] 内容 （如果知道记下的时间，写在最后）
```
2. 提示可同时复制 ChatGPT「设置 → 个性化 → 记忆 → 管理」的列表，补充可能遗漏的条目。
3. 用户贴回后，先用 `kaitu memory list --json-out` 比较已有记忆。
4. 拆成最小候选，标明新增、重复、矛盾与对应模块。
5. 蛋白质目标等内容归入规则修改建议，训练事实归健康记录，别塞进记忆。
6. 敏感内容只在用户明确要求保存时纳入，设置 sensitive 为 true。
7. 一屏列出候选及写入位置，等待用户选择与确认。
8. 仅把确认的记忆写成工作区 `inbox/memory-candidates.json` 数组。
9. 每项字段为 type、name、text，可带 source、sensitive。
10. type 取 preference、fact、context、person、decision；source 只写实际已保存的来源路径。
11. 运行 `kaitu memory import --file inbox/memory-candidates.json --dry-run`。
12. 预览与确认范围一致后运行 `kaitu memory import --file inbox/memory-candidates.json`。
13. 这批记忆只生成一个版本，用 `kaitu history memory` 查看。
14. 模块候选使用相应记录命令；修改 rules.md 或 goals.json 另列具体改动给用户确认。

## 确认点

批量候选一屏确认后才执行 import；涉及规则和目标须确认具体值。

## 交付

报告记忆数量、模块分流结果和整批恢复入口，不声称 ChatGPT 导出了全部记忆。
