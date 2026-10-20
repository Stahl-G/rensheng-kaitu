# 同一 Swift 原文件 → official consumer（等待 Swift 回读）

输入来自 Stahl-G/kaitu-ios PR10 固定 ce7d43cb818bf2ec83fb5bf0e293b1ffca74a4ef 的 docs/acceptance/onboarding-ui-1020/nutrition-first-stage/inbox/agents/ios-1234abcd-01M5BA4CESXS26JTZ22VC4NRYD.records.jsonl。

真实 PhoneMealDraft → PhoneRepository.confirmMeal → queue 持久化/恢复由原 iOS writer 完成；本端没有构造相似输入。Git blob 原样提取，253 bytes，SHA256 f8f33d8ede2eaad7f79a9170eb355299c7109e3ffc3443313f39fc7cd6264a10。输入及所有产物是明确合成数据。

本端保持原 basename/原字节复制到新官方 init ROOT 的 inbox/agents，真实完整 CLI 执行 phone run，再用 record list meal 回读。代码为 b21fee834764010560d903026e41f45d6da25bc8 实现（441d8399a097095b4914cb5c0706a3244de3de59 仅补证据格式），在独立副本加入依赖 PR62 a092270ff37f20200ddf5a7e8446684d54b46fc3。source fingerprints、真实命令、临时 root 和输入 hash 在 consumer-receipt.json.txt。没有替换 Git、改系统时间或给 producer 注入 now。输入 ts 04:30Z 比运行时稍晚，但同一上海自然日，契约按日期而非当天已过去时间汇总。

结果：Today 的 today=2026-10-20、timezone=Asia/Shanghai；nutrition v1 为 333.25 kcal / 21.5g，accounted_refs 仅原 basename。只有一条 canonical meal（consumer 分配 id），by=agent 保留原 origin assistant 署名映射；用户明确确认由 iOS cache 证明，origin 本身不是认证。原始 applied receipt 与两份私有 ledger 同批保留。receipt applied 不证明营养覆盖，覆盖证据仅来自同份 Today.accounted_refs。

## 回传原 writer

- phone/today.json.txt：原始官方 Today 字节
- phone/receipts.json.txt：同次 applied receipt
- ledger/phone-records.json.txt、ledger/inbox-records.json.txt：本机消费凭据
- input/inbox/agents/...records.jsonl：原始输入副本（hash 不变）

请同一 PhoneRepository 沿 iOS ce7d43c 的 phone-cache/queue.json 导入本次 Today/receipts，验证本机确认餐不再叠加、总量仍333.25/21.5，重启/同快照重送仍稳定。缺/不完整/未知 nutrition 的较新 Today 应仅降级营养区并推进整份水位，旧 v1 不能倒灌；不能用 applied receipt 代替覆盖。实际 Swift 回读结果由原 writer 固定后再补本报告，不将本段称为完整跨语言通过。

large-projection.json.txt 是额外合成 20,000 meal 的后台 core 测量：首次 overview 638.3ms + nutrition projection154.6ms，热读637.4ms +153.3ms；总量20000/20000正确。只是该单次样本，不是 UI/CLI 指标或延迟上界，未据此改变缓存/扫描架构。
