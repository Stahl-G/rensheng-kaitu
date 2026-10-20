---
name: log-meal
description: 用户提供饮食文字或照片时，估算并记录营养、误差及当天目标差距。
---

# 记录饮食

有开图工具时用下面的步骤；只能读写云盘时直接用「只能读写云盘时」小节，跳过 CLI 查询与安装。

## 步骤

1. 需要字段时只查 meal 单类型格式；需要模块特有规则才读 health/module.json，对照营养目标时才读 me/rules.md 的 nutrition。
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

## 只能读写云盘时

用户要记餐食时，在 `inbox/agents/<你的名字>-<唯一时间>.records.jsonl` 新建文件，一行一个对象并以换行结束。例如：

```jsonl
{"type":"meal","meal":"午","items":[{"name":"鸡肉饭","grams":400}],"kcal":650,"protein_g":35,"uncertainty":150,"source":"agent-estimate"}
```

示例食物与数值要按本餐实际内容或明确说明的估算替换；补记给带时区的 ts，字段不确定时只读 `skills/record-format/meal.md`。
没有本机查询能力时，跳过 CLI 查询，不虚构当天合计、目标差距或已入账结果。只为保存原话时用 `.note.md`，它不是餐食记录，整理员也不会自动把它记成餐食。
- 创建收件箱文件成功：说「已投递，等待电脑处理」。
- `.note.md` 已处理：说「原文已保存」，仍不称餐食已记入。
- 电脑处理结果并回读确认 meal：才说「餐食已记录」，列实际估算和误差。通用 note 的 applied 回执只确认原文，不能当作 meal 入账凭据。
无法核对结果时保留「待确认」，不换文件名重复投递同一餐；读取超时后报告缺口，不轮换工具重读同一文件。

## 确认点

日常记录无需确认；调整营养目标先确认具体值。

## 交付

报告本餐估算与误差、当天合计和目标差距。
