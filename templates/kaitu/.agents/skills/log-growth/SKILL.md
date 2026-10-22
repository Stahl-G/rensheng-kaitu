---
name: log-growth
description: 父母明确要求在孩子专属开图工作区记一条成长原文时使用。Save a parent's growth journal entry in the child's own Kaitu workspace.
---

# 记一条成长原文 / Save a growth journal entry

一个孩子一个工作区。沿用当前开图工具，不创建家长总档案或多个孩子的子目录。
One child per workspace; use the existing Kaitu tools.

1. 先确认会话中已明确当前工作区属于哪个孩子；已有明确说明不重问。未明确时只问这一点，写入前停在此处。不要搜索其他孩子或父母的工作区，不改个人档案来推断归属。
2. 使用 `kaitu_inbox`，参数为 `{"operation":"capture","text":"父母提供的原文"}`。保留父母的原话、事件日期和不确定性，不补造拍摄日期、年龄或“第一次”。保存的是原文，尚未整理为里程碑、学习或身体记录。
3. 以返回的 `path` 确认保存；`version` 有值才说版本已保存。回执不确定时用 `kaitu_inbox` 的 `notes` 核对该条原文，不重复创建。失败则说明原因。
4. 父母可在「资料 → 收件箱」读回原文，在「设置 → 导出全部资料」下载当前孩子工作区的 ZIP。导出只包含当前工作区，不能声称已包含其他工作区或未下载的云端文件。

Only write after the conversation identifies the current workspace as this child's. Preserve the parent's wording and uncertainty. Confirm with the returned path; a saved original is not an organized milestone. Read it in Library → Inbox and export this workspace from Settings → Export all data.

本切片只记文字。不要把成长照片作为体态照片录入，不进行视频分析、诊断、发育评估、性格判定或排名。照片归档和逐句来源小结待后续能力支持；本技能不自动创建报告、日程或任务，也不调用外部服务上传资料。
This slice saves text only. Do not route children's photos to body photos, analyze videos, diagnose, assess development, label personality, rank children, or automatically create reports, events, or tasks.
