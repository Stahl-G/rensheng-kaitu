# 健康格式扩展：HRV、症状、心理状态与心率通知

状态：2026-10-16 经用户批准修正版，HRV 与三类新健康记录已在本分支实现。
传输仍使用已发布的 `kaitu.health.v1`，不另造 v2 envelope。

## 已实现：HRV

`hrv_sdnn` 数值样本写为现有 `metric` 的 `kind: hrv_sdnn`，统一单位 ms。
手机可提供 ms 或 s，官方 XML 的 `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` 复用同一映射。
自然键沿用 `kind + UTC 测量时刻`。重复值不新增版本，修正值追加同 ID 修订，不改 schema。

手机实验开关继续默认关闭，以兼容尚未更新的 core。

## SDK 核验结果

本机 Xcode 27.0、iPhoneOS 27.0 SDK 中：

- 心理状态从 iOS 18 起可用。授权类型是 `HKObjectType.stateOfMindType()`，不是手工构造的 HKCategoryType。
- `HKSampleQueryDescriptor<HKStateOfMind>` 使用 `.stateOfMind(predicate)` 和 `result(for:)`。
- 心理状态效价有七级，包括 slightlyUnpleasant、slightlyPleasant。旧草稿的五级会丢信息。
- 食欲变化使用 `HKCategoryValueAppetiteChanges`，不是严重度枚举。
- 高心率、低心率和不规则心律通知使用 `HKCategoryValue.notApplicable`，不是 presence 枚举。

核验依据为安装 SDK 的 `HKObjectType.h`、`HKTypeIdentifiers.h`、`HKCategoryValues.h`、`HKStateOfMind.h`，
并以真实 SDK 类创建合成对象检查映射。构建通过不代表真机授权、实际读数或上传通过。

## 已批准的记录规范

用户已批准新增三类独立健康记录，已同步 PRD §6、schema、模块模板及 Agent 说明生成。
原草稿把心率通知写入 event 不适用：该类型在当前仓库表示日历日程，要求 calendar、title 等字段。
health 模块新增以下三类记录，日历事件的语义不变。

| 记录 | 字段 | 自然键 |
|---|---|---|
| symptom | kind、source；普通症状用 severity，食欲变化用 appetite_change | kind + UTC 时刻 |
| mood | valence、source | UTC 时刻 |
| heart_notification | kind、source | kind + UTC 时刻 |

三类记录都继承现有 record-base 的 id、ts、by、rev、deleted 等规则。
`source` 保存 apple-health，导入来源为 import:apple-health。
普通症状 severity 为 unspecified / mild / moderate / severe，notPresent 不导出。
食欲变化 kind 为 appetite_changes，appetite_change 为 unspecified / decreased / increased，noChange 不导出，
不伪装成严重度。schema 应保证普通症状和食欲变化只能使用各自的取值字段。

症状 kind：abdominal_cramps、appetite_changes、chest_tightness_or_pain、coughing、dizziness、fatigue、
headache、nausea、shortness_of_breath、sore_throat、chills，共 11 类。

mood.valence 保留 very_unpleasant / unpleasant / slightly_unpleasant / neutral /
slightly_pleasant / pleasant / very_pleasant 七级。
heart_notification.kind 为 high_heart_rate / low_heart_rate / irregular_rhythm。
这些是设备通知记录，不自行推断诊断结论。

手机分别输出 symptom_<kind>、state_of_mind、heart_notification 的字符串 value，unit 为空字符串。
导入保留实际 start 时刻为 ts，不把持续样本强行伪造为 start == end。
尚未定义的情绪或症状值保留原件并转待整理，不猜测映射。

## 迁移与灰度

importers/batch.ts 已扩展导入类型与自然键，health 模块已注册新记录。内置 schema 由 core 提供，
现有 upgrade 根据模板版本变化补齐旧工作区的记录定义，保留用户自定义配置。Agent 字段说明从 schema 生成。
本轮三类新域仅接通 kaitu.health.v1 的 samples 数组，尚未扩展官方 XML 的新域导出格式或并列列表。

已支持类型可与步数、HRV 混合入库。未知类型或非法取值仍使整份文件转待整理笔记，基础样本不部分入库。
三类实验开关继续默认关闭，
先部署并验证 core，再由用户手动开启。不能把“保留原件”宣传成已成功导入。

## 后续范围

ECG、用药、周期追踪、Google Drive 直传和健康专用 MCP 另行交付，本轮没有实现这些功能。
