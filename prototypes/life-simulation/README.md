# 人生往后推：当前规格与独立原型

本文件是这份原型的当前规格。用户 2026-10-28 确认的网页入口覆盖设计 v5 中的 DSH 专属开局；正式 Kaitu 的产品定义、数据格式及发布流程保持独立。

## 怎么玩

需要 Node 22.19+；没有第三方安装步骤。

```sh
cd prototypes/life-simulation
node server.mjs
```

打开 http://127.0.0.1:4783 。随机人生或用自己的 AI 生成角色卡，检查修改后开始。可以逐年走，也可以看到第五年；选择继续或放慢，再看十年结局。结局可保存 PNG，或保存包含角色卡、种子、规则版本和第五年选择的开局 JSON，再从首页载入。

`node build.mjs` 生成纯静态 `dist/`；`npm test` 构建并测试。程序用 Node 自带的 TypeScript 类型擦除器，不调用模型、不依赖后台、不加载 CDN。该 Node API 仍带 experimental 警告；产物为普通 ES modules，可被任何静态服务器提供。本地服务器只监听 loopback，且仅暴露 dist。

## 当前保留、改造与暂缓

| 部分 | 当前决定 |
|---|---|
| 两个入口 | 随机人生；自己的 ChatGPT / Claude / Gemini 生成角色卡，贴回并审阅。免登录、免安装、无自有模型 API。 |
| 时间 | 从输入的当前年龄开始，起点是现在；首个事件为下一年，固定十年切片，不模拟死亡。 |
| 对照 | 同一世界的“照现在过 / 改变一件事”，第 5 年可继续或放缓。结果是规则情景比较，不是行为因果识别。 |
| 个人化 | 昵称、当前状态、一件想做的事、五项游戏属性；属性只做游戏参数，不能从资料覆盖度、地图清晰度、MBTI 推断生活质量。 |
| 未知 | 卡片中的 null 始终保留；界面显示未知或 ?。模拟暂用中性档 3，规则面板可查看。不把缺记录当懒惰，不把未知当低分。 |
| 连续事件 | 做作品、联系他人、留出空白三组各 5 步链，加延续、忙碌、工作中断及重新就业事件。已知受雇状态才可能中断工作，创办人不被当雇员裁掉。没有婚姻、生育或学历升级事件。 |
| 世界 | 日常世界；一组“轨道来信”科幻场景验证相同接口。二者均为作者设定，无官方个人概率声明。 |
| 输出 | 纸质分叉图、逐年两线正文、可回看年份、本地 PNG、可重放开局。图的横向位置表达故事进度，非健康或人生价值。PNG 默认不含昵称、项目、年龄、种子或原始依据。 |
| 完整版接口 | 未来 Kaitu 从持续维护的资料生成同一 Card，调用同一 simulate；玩家明确选中的现实下一步可成为 Kaitu 建议。当前不读取 Kaitu 文件、不连接账号、不写 inbox、不点亮真实地图。 |
| 暂缓 | 六世界动态演化、隐藏结局、月度历史对比、现实下一步写回、全量事件库、联网分享、模型润色。 |
| 不实现 | 疾病诊断、死亡年龄判断、将 UN / WHO / World Bank 群体统计称为个人预测、排行榜与个人成功率。 |

## 输入边界

角色卡使用 JSON 与 version 字段，不另造文件语法。命名参考仓库现有 JSON / schema 约定；没有改动 PRD §6 或正式 schemas。v1 字段：

- name：昵称，最多 24 字符；age：0–110 整数或 null，开始前必须填写。
- role：employed / founder / student / other / unknown；只描述审阅后的当前状态。
- project：用户已明确想做的一件事，最多 40 字符。
- attributes：energy、knowledge、resources（时间与工具余量）、connection、joy，每项包含 value（1–5 或 null）与 source（最多 160 字符）。
- AI 提示词只请求最小卡片；依据注明 AI 估计。不请求完整记忆、地址、资产金额、疾病信息或他人隐私。

只解析白名单字段，限制 16,000 字符；非法年龄、职业状态、数值或 JSON 有可恢复错误；原粘贴内容保留。渲染统一转义。内容只在页面内存，关闭后清除；没有 localStorage、cookies、网络请求、遥测。用户点击“保存开局”才写浏览器下载；该 JSON 包含用户选择保留的角色卡，PNG 不含这些字段。

## Remake 复用边界

审查基准：[VickScarlet/remake f04888e202e5dfca0df48c51b8a099dc03cf08b4](https://github.com/VickScarlet/remake/tree/f04888e202e5dfca0df48c51b8a099dc03cf08b4)，MIT，许可全文在 `src/vendor/remake/LICENSE`，随 dist 分发。没有使用原事件文案、xlsx 数据、bili-toy、hooks UI、1in8b 或 AGPL fortune 代码。

- `vendor/remake/condition.ts`：移植 condition DSL。格式化、unknown 类型、显式数值比较、严格相等和变量写法调整；输入条件只来自本地事件定义，不接受用户提供代码。保持括号、include/exclude 所用比较及集合语义。
- `vendor/remake/random.ts`：移植 vitex 的 RNG、random、pick、pickWeight；范围交换改为局部变量。Kaitu 每次都注入有地址的抽样，绝不依赖默认 Math.random。
- `engine.ts`：实质改造 core/game.ts 的 start/next 和 core/event.ts 的检查、触发及分支过程。数据 Map 改成工厂实例内；当前年龄开局；效果改为通用属性；显式 requires/sets/clears；分支循环及缺失目标保护；状态通过复制隔离。无需 immer 或原 data 模块。
- `simulation.ts`：Kaitu 的场景编排和原创新事件；每条线使用独立 State，输入配置冻结在返回结果的副本中。

上游 core 不是完全独立纯函数：依赖 data Maps、talent GradeMap、achievement OpportunityMap 与 immer 初始化。原 age 表、空候选及无限分支需要额外约束。天赋表达式 `count ?? 0 >= max` 会先比较右侧再执行 nullish fallback；有非零 count 时会提前跳过。原型用显式链阶段，不携带这个天赋路径。原 21/22 core 测试结果属于提供的实跑报告；本实现没有声称重跑上游安装或数据构建。原数据构建缺 v-transform 锁定，本原型不走该构建链。

## 可复现方式与游戏假设

世界抽样地址是 worldSeed + 公历年 + environment；个人抽样地址是 lifeSeed + 公历年 + practice/event。地址被 JSON 编码后经 32 位哈希映射到 [0,1)。分支抽取次数不影响未来年份。两条线每年面对同一 worldId；个人改变只能改变自己状态和选择条件。种子不是随机秘密，不作安全用途。

当前“照现在过”每年投入阈值为 0.36，“改变一件事”为 0.78；共同世界状态调整 ±0.06，相关游戏属性调整每档 0.025。第 5 年放慢后恢复基线阈值，前五年保持不变。投入会推进故事，但消耗精力或余量；没有总分、胜负或“必然更好”结论。参数是玩法假设，不能解读为现实坚持率。

日常世界用三类共同外部节奏；科幻场景从第 4 年加轨道社区叙事。六世界和外星隐藏结局尚未实现，未来概率只能标为玩法参数。统计情景若后来加入，必须另外保存来源、口径、年份与不确定性，并与个人游戏参数分离。

## 材料与既有能力核对

- [设计 v5](https://drive.google.com/file/d/1CB5C2CtX4zr5RiOSte7hVenRDddsUnpm/view)
- [引擎实跑报告](https://drive.google.com/file/d/15qElZZKHScNk5iOitRXvrWuKXUNryHJO/view)
- [独立源码核对](https://drive.google.com/file/d/1ZZzpmhubpzw09AqbESw884YUu95y_dHX/view)
- 已核当前 AGENTS.md、GOAL.md、PRODUCT.md、HANDOFF.md、import-chatgpt-memory 与 build-life-map Skill。
- 现有 `packages/core/src/onboarding.ts` 的 parseMemoryPaste / preview / confirm 和 `handover.ts` 的剪贴板协议均服务于真实记忆与本机工作区，带 Node 文件系统、去重和写入职责。原型复用其“给提示词→带回→核对”交互，独立校验游戏 Card，避免把模拟写成事实；未复制第二套真实记忆导入器。

验收截图、测量脚本和实测结果保存在仓库外，汇总在 Draft PR 描述。正式上线仍需真人试玩、内容扩写和产品验收。
