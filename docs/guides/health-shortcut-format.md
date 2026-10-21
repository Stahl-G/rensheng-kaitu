# 快捷指令健康文件格式

快捷指令可导出原始样本数组或并列列表，保存为 `YYYY-MM-DD.health.json`，放进工作区的 `inbox/health/`。
开图负责单位换算、来源选择、睡眠合并、日期切分与去重。
工作台 `kaitu ui` 运行时自动处理，也可运行 `kaitu inbox process`。
旧工作区先运行 `kaitu upgrade`，可用 `--dry-run` 预览。

## 并列列表

适合快捷指令分别「获取健康样本的详细信息」，再将各列表用换行符连接为文本，无需循环构造对象数组。
每份文件一种 `type`，必填 `type`、`values`、`starts`；有这三个字段即可识别，`format` 可省略或为 `kaitu.health.v1`。
`exported_at`、`device` 可省略。

```json
{
  "type": "step_count",
  "values": "4820\n383",
  "starts": "2026-10-14T06:36:28+07:00\n2026-10-15T06:41:39+07:00"
}
```

`values`、`starts` 及可选的 `ends`、`units`、`names`、`sources` 都是换行分隔的字符串，同一行对应同一项。
支持 LF、CRLF、CR 换行，行首尾空白会去除，但不丢弃空行；不要加末尾换行。
提供的每列行数必须与 `values` 相同，单个单位或来源也需逐行重复，不会自动广播。
行数不一致时整文件转为待整理笔记，原因会指出列名与行数，原件作为附件保留，不导入部分行。
`values`、`starts` 不可有空行，时间必须带偏移；两者都是空字符串（没有样本）时整份直接归档。`ends` 省略时取 `starts`，睡眠除外。
`units` 省略时使用下表单位；`sources` 省略时统一视为「快捷指令」来源。

| type | values / 默认单位 | 整理结果 |
|---|---|---|
| `step_count` | 每日累计步数 / `count` | activity 的 `steps` |
| `active_energy` | 每日活动热量 / `kcal` | activity 的 `active_kcal` |
| `basal_energy` | 每日基础热量 / `kcal` | 与活动热量相加，写 activity 的 `total_kcal` |
| `body_mass` | 体重 / `kg` | metric 的 weight，`units` 为 `lb` 时换算为 kg |
| `body_fat_percentage` | 0–1 小数 / `fraction` | metric 的 body_fat，乘 100 转百分数；也可指定 `%` 提供百分数 |
| `resting_heart_rate` | 静息心率 / `bpm` | metric 的 resting_hr |
| `hrv_sdnn` | HRV(SDNN) / `ms` | metric 的 hrv_sdnn；`units` 为 `s` 时转为 ms |
| `sleep_analysis` | 阶段名 / 空字符串 | 必须提供 `ends`，共用原始样本的睡眠合并规则 |
| `workout` | 时长（分钟）/ `min` | cardio 训练；`names` 为活动名称，省略时为「其他训练」，`ends` 可省略 |

步数、活动热量、基础热量必须先在快捷指令按天汇总。日期取 `starts` 在用户时区的本地日期，
即使首条样本不在午夜，也将完整数值记在该日；提供 `ends` 也不会跨日分摊。
今天可以是未结束的当天累计，稍后重新导入新累计会更新同一天的记录，不重复添加或累加旧值。
不同类型分文件导入时保留同一天的其他活动字段，`total_kcal` 始终由已导入的活动与基础热量相加。
身体指标的测量时刻取 `starts`。

睡眠阶段接受以下中英文名称，也接受下文的原始样本阶段名与官方名称：

| 中文 | 英文 | 是否计入睡眠 |
|---|---|---|
| 核心、核心睡眠 | Core | 是 |
| 深度、深度睡眠 | Deep | 是 |
| 快速动眼、快速眼动、快速动眼睡眠 | REM | 是 |
| 睡眠、睡着、已入睡 | Asleep | 是 |
| 清醒 | Awake | 否 |
| 在床上 | In Bed | 否 |

未知 `type` 整文件转为待整理笔记。单位换算、睡眠合并和训练名称转换均复用 Apple Health 映射。
`names` 可用中文活动名或 `running` 等活动标识，中文名称保留。

## samples 数组

```json
{
  "format": "kaitu.health.v1",
  "exported_at": "2026-10-15T08:30:00+08:00",
  "device": "iPhone",
  "samples": [
    {
      "type": "step_count",
      "start": "2026-10-14T08:00:00+08:00",
      "end": "2026-10-14T08:10:00+08:00",
      "value": 800,
      "unit": "count",
      "source": "Apple Watch"
    },
    {
      "type": "sleep_analysis",
      "start": "2026-10-13T23:30:00+08:00",
      "end": "2026-10-14T06:30:00+08:00",
      "value": "asleep",
      "unit": "",
      "source": "Apple Watch"
    },
    {
      "type": "workout",
      "start": "2026-10-14T18:00:00+08:00",
      "end": "2026-10-14T18:30:00+08:00",
      "value": 30,
      "unit": "min",
      "source": "Apple Watch",
      "workout": {
        "activity": "running",
        "duration_min": 30,
        "distance_km": 5,
        "kcal": 300,
        "avg_hr": 145
      }
    }
  ]
}
```

`samples` 必填，也可以直接导出样本数组；`format`、`exported_at`、`device` 可省略。
每条样本至少有 `type`、`start`、`value`：`end` 省略时取 `start`，`unit` 省略时用下表单位，`source` 省略时用 `device`，再没有就是「快捷指令」。
时间用 ISO 8601，带 `Z` 或 `±HH:MM` 偏移；不带偏移时按用户时区的当地时间读。瞬时测量的 `start` 与 `end` 相同。
数值可带单位和千分位（如 `8,532 步`、`65.2 公斤`）；类型也可用官方标识（如 `HKQuantityTypeIdentifierStepCount`）或中文名（如 步数）。
单条样本读不出（没有数值、时间不对）或类型不支持时只跳过这一条并计数，其余照常导入；整份都读不出时才转为待整理笔记。
日期归属以 `me/rules.md` 的用户时区为准，文件名和 `exported_at` 不决定记录日期。
可选 `window: { "start": …, "end": … }` 写明本次采集的起止时间（`end` 省略表示采到导出为止）；
提供时，步数、热量等按天累计只写进窗口完整覆盖的日子，手机与电脑时区不同时不会把整天累计改成半天。

| type | value / unit | 整理结果 |
|---|---|---|
| `step_count` | 数值，`count` | 每日步数 |
| `body_mass` | 数值，`kg`、`lb` 或 `g` | 体重，转为 kg |
| `body_fat_percentage` | 数值，`%`（18 表示 18%）或 `fraction`（0.18 表示 18%） | 体脂率，转为 % |
| `resting_heart_rate` | 数值，`bpm` 或 `count/min` | 静息心率 |
| `hrv_sdnn` | 数值，`ms` 或 `s` | 心率变异性 SDNN，统一为 ms |
| `sleep_analysis` | 字符串，unit 为 `""` | 睡眠片段 |
| `active_energy` | 数值，`kcal`、`kJ` 或 `cal` | 活动热量 |
| `basal_energy` | 数值，`kcal`、`kJ` 或 `cal` | 基础热量，与活动热量合计为总热量 |
| `workout` | 数值为时长，unit 为 `min`，另有 `workout` 对象 | 训练 |
| `symptom_<kind>` | 字符串，unit 为 `""` | symptom；普通症状为 severity，食欲变化为 appetite_change |
| `state_of_mind` | 七级情绪字符串，unit 为 `""` | mood 的 valence |
| `heart_notification` | high_heart_rate / low_heart_rate / irregular_rhythm，unit 为 `""` | 独立 heart_notification 记录 |

睡眠 value 接受 `asleep`、`asleep_core`、`asleep_deep`、`asleep_rem`、`asleep_unspecified`；
`awake`、`in_bed` 可原样提供，但不计入睡眠。也接受官方 `HKCategoryValueSleepAnalysisAsleep…` 名称。
同来源相隔不足 60 分钟的片段合并，重叠时段只计一次；同一夜选择总睡眠最长的来源。
导出前一天睡眠时，需包含入睡至醒来的完整片段，保留前一晚的开始时间。

步数和能量在各来源内求和，再取最大来源，避免手机与手表重复累加；跨本地午夜的样本按时长分摊。
每天导出前一天的完整原始样本集合，同一天补导时仍提供完整集合。

`workout.activity` 与 `workout.duration_min` 必填，时长大于零；`distance_km`、`kcal`、`avg_hr` 可省略。
活动名用 `running`、`cycling`、`walking`、`swimming`、`traditional_strength_training` 等下划线名称。
开图转换为中文活动名，所有 Apple 体能训练均记为 `modality: cardio`；未知活动显示为「体能训练」。
力量训练仅导入时长，组数、次数、重量由用户另行记录。

## KaituSync 三类新域

三类新域只支持 samples 数组。并列列表和官方 XML 的新域格式尚未接入；现有类型与 HRV 的原有入口保持不变。
症状 kind 共 11 类：abdominal_cramps、appetite_changes、chest_tightness_or_pain、coughing、dizziness、fatigue、
headache、nausea、shortness_of_breath、sore_throat、chills。
普通症状 value 为 unspecified / mild / moderate / severe；食欲变化只接受 unspecified / decreased / increased。
手机不导出未出现的症状和未变化的食欲，不把它们当作新发生的事件。

心理状态保留 very_unpleasant / unpleasant / slightly_unpleasant / neutral / slightly_pleasant / pleasant / very_pleasant。
心率通知独立存储在健康模块，不生成日历事件。导入时三类均以 start 作为 ts，转为用户时区。

旧工作区执行 kaitu upgrade 后即可使用新记录。手机实验开关默认关闭，更新本机运行时后再由用户手动开启。

## 收件箱处理

两种 JSON 格式和官方 XML / zip 使用相同的映射与导入来源 `import:apple-health`。
自然键：指标、症状与心率通知为 kind + UTC 测量时刻，心理状态为 UTC 时刻；
活动为本地 date，睡眠为 start，训练为开始时刻 + 中文活动名。
同一键内容变化会追加修订；相同样本重复导入不新增记录或版本。
有改动时整份文件一个版本，说明为「从 Apple 健康同步了 N 条记录（快捷指令）」。

处理前间隔 1.5 秒核对文件大小与时间，解析后再检查一次；仍在同步的文件留到下一轮。
成功原件移到 `inbox/processed/YYYY-MM-DD/`，同名文件保留独立副本。
健康原件归档但不进版本历史，整理后的记录进入历史。
失败时整份文件保留为 `inbox/notes/YYYY-MM-DD/files/` 下的附件，并生成附原因的待整理笔记。
官方 `export.zip` / `export.xml` 也可直接放入同一收件箱，无需改成 JSON。
