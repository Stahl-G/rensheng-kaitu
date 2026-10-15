---
name: log-workout
description: 用户描述力量或有氧训练时，记录实际训练并对比上次同项目表现。
---

# 记录训练

## 步骤

1. 读取 health/module.json，用 `kaitu record schema workout` 确认字段。
2. 运行 `kaitu record list workout --json-out`，查同项目、同训练方式的上次记录。
3. 「深蹲 3×12，60kg」按力量记录，modality 可省略；必填 exercise、sets、reps、weight_kg、session_id。
   同次力量训练共用 session_id，延续当前训练时复用已知标识，新训练用新标识。
   缺重量或次数会影响记录时才询问；徒手动作可用 weight_kg: 0。
   不把每组不同次数硬凑成统一 reps，必要时分条并写 notes。
4. 「跑步 5 公里 28 分钟」按有氧记录，设置 modality: cardio、exercise: 跑步、distance_km: 5、duration_min: 28。
   跑步、骑行、游泳、划船、步行等有氧必填 exercise、duration_min，缺时长才询问。
   已知时可填 distance_km、avg_hr、kcal、elevation_m、rpe、notes、session_id，不要求组次或重量。
5. 补记过去训练时给 ts，使用用户时区的带偏移时间。未说的数据不代填。
6. 示例命令：
```sh
kaitu record add workout --json '{"exercise":"深蹲","sets":3,"reps":12,"weight_kg":60,"session_id":"本次训练唯一标识"}'
kaitu record add workout --json '{"modality":"cardio","exercise":"跑步","duration_min":28,"distance_km":5}'
```
7. 力量训练对比上次同动作的目标组次和完成情况：达到计划且动作质量无问题时，下次建议增加 2.5kg；未达标则保持重量。
8. 有氧不给加重建议。有距离时按 duration_min / distance_km 对比上次同项目配速，并说明距离与环境差异；没有距离时对比时长。
9. 首次记录先建立基线。建议只是下次安排，不当成已经完成的记录。
10. 运行 `kaitu record list workout --from YYYY-MM-DD --to YYYY-MM-DD` 核对写入，日期按用户时区。
11. 需要时引导 `kaitu ui` 看力量重量趋势与近 30 天有氧距离、时长。

## 确认点

日常训练记录直接写；要改变长期训练规则时先确认。

## 交付

报告实际训练数据、与上次的对比及有依据的下次建议。
