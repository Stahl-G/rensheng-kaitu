# 健康只读 MCP 工具提案

状态：2026-10-16 修订设计稿。四个工具尚未注册，不表示已经可调用。
目标是在现有 record_list 之上提供领域查询，不改传输协议或健康数据所有权。

## 工具与真实数据源

| 工具 | 参数 | 数据源与输出 |
|---|---|---|
| health_metrics | start、end、metrics?、interval?、aggregate? | metric 与 activity；体重、HRV 等取均值，步数 / 能量按日求和 |
| health_sleep | start、end、include_segments? | sleep 的每夜起止、duration_min 与来源 |
| health_workouts | start、end、include_details? | workout，区分 strength 与 cardio；不是不存在的独立 cardio 记录 |
| health_events | start、end、kinds? | 已接入的 symptom、mood、heart_notification，不混入日历 event |

所有工具通过现有 register 注册，标为只读，复用 readRecords 和用户时区处理，不增加依赖。
数据来自上次成功入库，不查询手机实时 HealthKit。输出应附查询区间、命中记录数和数据时间范围，
不能用“最近一次空文件上传”或“最近处理收件箱”冒充每种健康指标的新鲜度。

## 日期与聚合约定

start、end 接受 YYYY-MM-DD 或带偏移的 ISO 8601 时间戳，拒绝不带时区的日期时间。
日期形式的 end 包含该本地日，转换成次日零时的排他上界；完整时间戳 end 为排他上界。
start 为包含边界。按工作区用户时区分桶，不能依赖服务器时区或假定每天恒为 24 小时。

metrics 为逗号分隔的 kind，包含 weight、body_fat、resting_hr、hrv_sdnn、steps、active_kcal、total_kcal 等。
默认 aggregate=true，返回每指标区间汇总；aggregate=false 才按 interval=days / weeks 输出桶。
周以用户时区周一为起点，缺失保留为空，真实零值保留为零；不同单位不得混在同一均值中。
复合字符串指标如血压不取数值均值，应返回原始测量及明确的不可聚合原因。

睡眠日期以醒来所在的本地日归属，查询原始记录时必须处理跨午夜睡眠。
当前 core 的 sleep 已合并且不保留 Core / Deep / REM 分期，因此 include_segments
最多提供现有 start / end / duration_min，不能伪造逐阶段片段；如需分期必须另扩展存储规范。

include_details=false 时训练返回动作 / 项目、时长或组次摘要；true 保留已有力量字段与有氧距离、热量、心率。
health_events 的 kinds 选择症状、心理状态、心率通知。底层类型未就绪时不能返回空列表冒充已支持。

## 鉴权和权限

保留当前 stdio / HTTP MCP 的鉴权方式。HTTP 目前只监听本机回环地址并检查 Bearer token，
不把它描述成已经部署好的公网健康服务。授权范围来自宿主和现有 remote / all 工具集。

## 实现与验收

1. 三类健康记录规范与导入器已在本分支落地。
2. 在 core 新增小型健康查询模块，在 cli/src/mcp/server.ts 注册四个只读工具。
3. 在生成的 Agent 入口说明中列出工具与数据时间语义，保留现有通用 record_list。
4. 使用 SDK MCP 客户端验证工具可发现、实际查询结果、时区边界与没有写入副作用。

本轮 HRV 与三类新域导入完成；以上四个工具仍是后续可评审方案。通用 record_list 已能查询新记录。
