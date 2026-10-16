# 确认日程推送系统日历：交审记录

基线：`fee1276`，分支 `codex/calendar-push`。后端提交：`ced1cf8`。

## 已完成

- core 负责确认时间段筛选、可信本机映射、幂等与删除标记、ICS 和可注入执行器接口。
- 独立 App 主进程注入 Calendar JXA 执行器。参数只经 JSON argv；仅操作「开图」日历中映射的事件。
- 确认、排下一步、调整时间和取消均返回日历结果。关闭停止写入，已写入的保留，可主动移除。
- 映射不进入工作区或同步盘。未修改 PRD §6 和 schemas，未使用 Computer Use，未推送或合并。

## 自动检查

后端提交前：`pnpm build && pnpm typecheck && pnpm lint && pnpm test` 全部通过，69 个测试文件、170 项测试。
界面与文档提交前同样执行上述四项检查，全部通过，69 个测试文件、170 项测试。
本任务仅增加两个行为测试。使用临时目录、合成资料和假执行器，不调用真实 osascript。
覆盖确认筛选、重复确认、保持 UID 的改期、拒绝/取消、源 task 取消、关闭保留、日历手动删除不复活，以及失败时固定 UID 的可解析 ICS。

## 浏览器验收

使用构建后的 `node packages/cli/dist/main.js ui --dir <合成工作区> --port 0 --no-open`，由 Playwright Chromium 无头浏览器操作。
HOME、KAITU_APP_HOME、KAITU_LOCAL_STATE_DIR 均指向临时目录；未读写个人工作区或真实 `~/.kaitu-app`。

| 操作 | 实际结果 | 截图 |
|---|---|---|
| 今天页确认带时间建议 | 状态变为已确认，出现日历文件结果、原因、下载和重试 | [今天页](01-today-file.png) |
| 下载日历文件 | 实际下载成功，UID 为 `kaitu-block-synthetic-proposal-1` | 同上 |
| 给刚采纳的下一步排 16:00–17:00 并确认 | 写入 NOW.md，日程出现相应时间段和文件结果 | [下一步](02-next-slot.png) |
| 日程页确认另一条建议，再调整为 14:30–15:30 | 原时间段 ID 不变，页面和文件更新 | [日程详情](03-calendar-rescheduled.png) |
| 取消日程 | 事件从日程视图消失，出现取消文件；回读状态为 rejected | 同次运行 |
| 关闭开关，主动移除 | 开关为关闭，浏览器模式提供取消文件；重载后关闭状态保留 | [设置](04-settings-off.png) |
| 390px 窗口 | 设置开关和移除、下载操作可见 | [窄窗口](05-settings-narrow.png) |
| 重新确认已取消建议并重试 | 文件 UID 仍为 `kaitu-block-synthetic-proposal-2` | 接口回读 |

没有浏览器 JavaScript 运行时异常。FullCalendar 自带 fcicons 字体触发现有 CSP 的内嵌字体拦截提示；页面使用文字导航，以上操作均完成，未放宽 CSP。
截图已经逐张检查。浏览器确认的是文件生成、下载和本地资料回读，不代表 Calendar.app 已导入。

## 本机待验

真实 Calendar.app 写入、系统自动化弹窗与拒绝/恢复、正式签名权限归属、ICS 重复导入/取消，以及 iCloud 到 iPhone、手表提醒，留给用户验收。
步骤见 [desktop.md 的本机手动验收](../../desktop.md#本机手动验收)。
Calendar 的脚本接口不能选择账户，首次需确认「开图」位于 iCloud；排下一步复用当前 NOW.md 计划日期，界面调整的是当天起止时间。
