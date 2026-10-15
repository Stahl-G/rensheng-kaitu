---
name: log-workout
description: 用户描述训练动作、组数、次数和重量时，记录同次训练并给出下次建议。
---

# 记录训练

## 步骤

1. 读取 health/module.json，确认 workout 的记录定义。
2. 运行 `kaitu record list workout --json-out`，查同动作上次训练。
3. 把「深蹲 3×12，60kg」拆成 exercise、sets、reps、weight_kg。
4. 同次训练共用一个 session_id；延续当前训练时复用已知 session_id。
5. 新训练生成新的 session_id，不把同一动作不同日期混在一起。
6. 缺重量或次数会影响记录时才询问；徒手动作可用 weight_kg: 0。
7. 用户补记过去训练时给 ts，使用用户时区的带偏移时间。
8. 不把每组不同次数硬凑成统一 reps，必要时分条并写 notes。
9. 示例命令：
```sh
kaitu record add workout --json '{"exercise":"深蹲","sets":3,"reps":12,"weight_kg":60,"session_id":"本次训练唯一标识"}'
```
10. 多动作分别调用命令，保持同一个 session_id。
11. 记录可选的 rpe、notes，未说的感受不代填。
12. 对照上次同动作的目标组数、次数和实际完成情况。
13. 达到计划组次且动作完成质量无问题时，下次建议增加 2.5kg。
14. 未达标则保持重量，指出需要先完成的组次。
15. 首次记录没有上次基准时，先建立基线。
16. 建议只是下一次训练安排，不把它当作已经完成的记录。
17. 运行 `kaitu record list workout --from 今天 --to 今天` 核对写入。
18. 需要时引导 `kaitu ui` 看动作重量趋势。

## 确认点

日常训练记录直接写；要改变长期训练规则时先确认。

## 交付

报告实际记录的组次重量、同次训练标识及下次建议。
