---
name: health-import
description: 用户提供 Apple Health、Nut AI 或日历导出时，预览并确认后调用现有导入器。
---

# 导入健康与日历

## 步骤

1. 先识别文件来自 Apple Health、Nut AI 还是日历 .ics。
2. 读取 me/rules.md 的时区，导入日期按该时区切分。
3. Apple Health 使用 iPhone 健康应用导出的 export.zip，也支持 export.xml。
4. Nut AI 使用应用导出的 backup.json，不把任意 JSON 当成 Nut AI 数据。
5. 日历使用 .ics 文件，先确认日历名称与需要覆盖的时间区间。
6. 先运行相应的预览命令：
```sh
kaitu import apple-health "inbox/export.zip" --dry-run --json-out
kaitu import nut-ai "inbox/backup.json" --dry-run --json-out
kaitu import ics "inbox/calendar.ics" --calendar "个人" --from YYYY-MM-DD --to YYYY-MM-DD --dry-run --json-out
```
7. 只执行与实际文件对应的命令，不运行全部示例。
8. 把新增、更新、删除和跳过数量放在一屏，指出映射不了的内容。
9. ICS 快照可能删除窗口内同来源已消失事件，要明确展示删除数量。
10. 用户确认后移除 --dry-run，其他参数与预览完全一致。
11. 文件或工作区数据有变化时，重新预览并确认。
12. 读取命令结果中的版本，用 `kaitu history` 提供恢复入口。
13. 运行 `kaitu validate` 检查导入结果。
14. 用 `kaitu record list <类型> --from 起日 --to 止日` 抽看覆盖范围。
15. 引导 `kaitu ui` 查看健康趋势或已有日程。
16. 没有部署服务也能导入；不在此流程搭建 Oura 或外部日历写入。

## 确认点

导入一屏确认后执行；ICS 删除属于同一次导入的确认范围。

## 交付

报告真实新增、更新、删除、跳过数量及数据覆盖日期。
