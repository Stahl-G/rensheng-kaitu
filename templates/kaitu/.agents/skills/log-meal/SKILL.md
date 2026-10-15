---
name: log-meal
description: 用户提供饮食文字或照片时，估算并记录营养、误差及当天目标差距。
---

# 记录饮食

## 步骤

1. 读取 me/rules.md 的 nutrition 与 health/module.json。
2. 运行 `kaitu record list meal --from 今天 --to 今天 --json-out`。
3. 识别早、午、晚或加餐，拆出食物名称和已知份量。
4. 份量没说或看不清时，按常见份量直接估算并写进 uncertainty，不追问；记录后一句话说明假设，用户可再修正。
5. 区分包装标注、用户称重和目测，不冒充精确测量。
6. 估算热量 kcal、蛋白质 protein_g，可补 carbs_g、fat_g。
7. 文字和照片的估算都必须写 uncertainty，单位为 kcal 的合理误差幅度。
8. 不把 uncertainty 写成百分比或字符串。
9. source 写明 agent-estimate，包装标签可用 label。
10. 只在确实已保存图片时填写 photo，不写不存在的路径。
11. 示例命令：
```sh
kaitu record add meal --json '{"meal":"午","items":[{"name":"鸡肉饭","grams":400}],"kcal":650,"protein_g":35,"uncertainty":150,"source":"agent-estimate"}'
```
12. 补记时给带偏移的 ts；没有拍摄时间不读 EXIF 来猜。
13. 核对今天已有记录，防止同一餐重复添加。
14. 误记用 `kaitu record update meal <id> --json ...` 修正。
15. 重新查询当天 meal，按记录求和热量和蛋白质。
16. 对照 rules.md 的 protein_g 范围，说明还差多少。
17. 只有有当天总消耗时才计算热量缺口并与 deficit_kcal_max 对照。
18. 可用 `kaitu ui` 饮食页查看今天汇总。

## 确认点

日常记录无需确认；调整营养目标先确认具体值。

## 交付

报告本餐估算与误差、当天合计和目标差距。
