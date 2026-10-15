# 快捷指令健康文件格式

快捷指令只读取原始样本，按下面的格式保存为 `YYYY-MM-DD.health.json`，放进工作区的 `inbox/health/`。
开图负责单位换算、来源选择、睡眠合并、日期切分与去重。
工作台 `kaitu ui` 运行时自动处理，也可运行 `kaitu inbox process`。
旧工作区先运行 `kaitu upgrade`，可用 `--dry-run` 预览。

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

`format`、`exported_at`、`device`、`samples` 必填。每条样本包含 `type`、`start`、`end`、`value`、`unit`、`source`。
所有时间均为 ISO 8601，带 `Z` 或 `±HH:MM` 偏移；瞬时测量的 `start` 与 `end` 相同。
日期归属以 `me/rules.md` 的用户时区为准，文件名和 `exported_at` 不决定记录日期。

| type | value / unit | 整理结果 |
|---|---|---|
| `step_count` | 数值，`count` | 每日步数 |
| `body_mass` | 数值，`kg`、`lb` 或 `g` | 体重，转为 kg |
| `body_fat_percentage` | 数值，`%`（18 表示 18%）或 `fraction`（0.18 表示 18%） | 体脂率，转为 % |
| `resting_heart_rate` | 数值，`bpm` 或 `count/min` | 静息心率 |
| `sleep_analysis` | 字符串，unit 为 `""` | 睡眠片段 |
| `active_energy` | 数值，`kcal`、`kJ` 或 `cal` | 活动热量 |
| `basal_energy` | 数值，`kcal`、`kJ` 或 `cal` | 基础热量，与活动热量合计为总热量 |
| `workout` | 数值为时长，unit 为 `min`，另有 `workout` 对象 | 训练 |

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

JSON 和官方 XML / zip 使用相同的映射与导入来源 `import:apple-health`。
自然键：指标为 kind + 测量时刻，活动为本地 date，睡眠为 start，训练为开始时刻 + 中文活动名。
同一键内容变化会追加修订；相同样本重复导入不新增记录或版本。
有改动时整份文件一个版本，说明为「从 Apple 健康同步了 N 条记录（快捷指令）」。

处理前间隔 1.5 秒核对文件大小与时间，解析后再检查一次；仍在同步的文件留到下一轮。
成功原件移到 `inbox/processed/YYYY-MM-DD/`，同名文件保留独立副本。
健康原件归档但不进版本历史，整理后的记录进入历史。
失败时整份文件保留为 `inbox/notes/YYYY-MM-DD/files/` 下的附件，并生成附原因的待整理笔记。
官方 `export.zip` / `export.xml` 也可直接放入同一收件箱，无需改成 JSON。
