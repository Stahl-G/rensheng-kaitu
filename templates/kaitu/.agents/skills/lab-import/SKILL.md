---
name: lab-import
description: 用户提供体检报告时，提取指标和原文参考范围并保存为可核对的体检记录。
---

# 整理体检报告

## 步骤

1. 读取 health/module.json 与已有 health/data/labs/ 文件。
2. 确认报告日期和本机原件，不把上传日期当体检日期。
3. 逐页读取报告；扫描件只在有可用识别能力时提取。
4. 看不清的数值留待补，不根据常识补数字。
5. 每项记录 name、value、unit，以及报告原文中的 ref_range。
6. 只依据报告参考范围写 flag: high、low、abnormal 或 normal。
7. 不同单位、性别或年龄对应范围不能混用。
8. 保留报告的项目名称，必要时在说明中补通用名。
9. 先展示一屏指标、单位、参考范围和原件路径供用户核对。
10. 确认后把原件复制进 health/files/，文件名使用日期与短英文标识。
11. 写 `health/data/labs/YYYY-MM-DD-<slug>.json`。
12. 文件结构为 date、items 数组、file；file 使用相对健康模块的原件路径。
13. 这是独立报告 JSON，不使用 `kaitu record add lab`。
14. items 中每项包含 name、value、unit，其他字段按实际报告填写。
15. 同一天多份报告用不同 slug，不覆盖已有报告。
16. 运行 `kaitu validate health/data/labs`，修复结构问题。
17. 运行 `kaitu snapshot -m "Agent 整理了体检报告"`。
18. 引导 `kaitu ui` 在身体指标页核对报告与异常标记。
19. 需要复查时只提出供用户与专业人员讨论的事项，不替用户下诊断。

## 确认点

体检报告的批量指标先一屏核对确认；不自动另存敏感记忆。

## 交付

报告保存位置、无法识别的项目与原报告标出的异常。
