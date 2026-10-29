# 人生往后推 · 独立网页原型

当前范围是 2026-10-28 确认的 Sinatra 20 条 + 清理 21/22，随后加入桌面生活场景要求。仅此目录；不改正式 App、正式 schema，不合并、不部署。六世界、隐藏结局、PPP、真实 Kaitu 数据接入与公开托管不在本轮。

## 运行

```sh
cd prototypes/life-simulation
node server.mjs
```

http://127.0.0.1:4783 。Node 22.19+，无需安装依赖。`npm test` 构建并运行行为测试；`node build.mjs` 生成纯静态 `dist/`。全部资源用相对路径，支持静态站的 `/play/` base path；当前仅 loopback 本地服务器。Node 类型擦除 API 会打印 experimental 提示，浏览器收到普通 ES modules。

随机人生一键开局；AI 角色卡入口可选。第一年立即出现，普通年度 1×/2×/4× 自动推进（思考间隔 45/22.5/11.25 秒），第 3/6/9/12 年前暂停抉择。可暂停、快进、回看、重玩同一开局。查看细节或标签隐藏即停表，继续须主动点击并重新计一个完整年度间隔；后台延迟不补跑年份。时间栏显示当前约每年时长。主画面是原创人物、住所与工作场景；双线图收在回顾及导出卡。

## 当前玩法

- 健康、知识、关系、快乐为 0–100 游戏属性，每年重读。未提供的属性在原卡保留 null，模拟取中性 50；不由记录多少、地图清晰度或身份推算低分。无人生总分、疾病诊断或死亡预测。
- 七类决策：转职、创业、出国、投资、继续读书、照现在过、自定义。有门槛、成本与失败。创业再选贷款或自筹；投资再选债券、指数或房产。自定义保留 project 原文，玩家选择创作、学习或组织活动路线；不宣称没有模型也能理解任意语义。
- 主职业是单一 role（employed/founder/student/unemployed/retired），abroad/investor 是可叠加状态。固定五句链已经移除；原创事件池按当前身份、属性、年龄、资产与共同世界冲击筛选、加权并冷却。自动条件分支与玩家决策分别在 engine / decisions 中。
- 入学→考核→毕业/延期；创业→经营/关闭→欠款与睡眠影响→求职恢复。欠款有宽限、催缴、卖资产、合租；只有持续拖欠、无收入、无现金、低支持且无可用伴侣支持等同时满足时才失去稳定住所，恢复押金后可搬回。不存在失败必然一路无家可归。敏感事件附求助链接。
- 年度重心行内切换。长期习惯为两年求职、两年职训、月末定投；资金或身份不够时挂起，每年重查，执行后重新计算两年间隔。
- 基线始终均衡、无新习惯、所有抉择照现在过。玩家线保存每次决策与年度计划。两条线共用 worldSeed、年份与市场类别的有地址抽样；各自状态独立，分支不改变后续共同行情。

## 金额、行情与账本

金额全部是模拟人民币，不声称是用户真实财务。内部用整数分；初始现金 ¥26,000、存款 ¥64,000，无其他资产/负债，所有角色相同。工资由职业、年限、学历、专业、海外状态与共同需求变化计算；所有工资基数、简化 18% 税社保比例和生活支出均是游戏假设，不是税务计算器或劳动市场统计。

资产：现金、存款、债券、股票、房产；负债及利率单列。每年账本保存收入、费用、资产回报与转账。借款、买卖资产、还本金是重分类；费用、利息和亏损才改变净资产。未付费用计入欠款，利息计一次，不重复冲减现金。每年强制核对：期初净资产 + 收入 − 费用 + 资产回报 = 期末净资产。

行情参数集中于 `src/market.ts`。存款/债券/指数/房产的均值与波动均由作者设定，数值来源明确为游戏配置，不能称为机构预测或历史估计。配置附原始机制参考：ICBC 存款挂牌利率页面、SEC Investor.gov 的债券、资产配置与分散投资材料；这些资料不为本游戏具体数值或行为系数背书。危机概率 9% 也是玩法参数。股票和债券用含分配的总回报，不再另加股息；房产只记价格变化，不额外加租金。

定投按 12 次月末入账；月度路径是由共同年度回报开 12 次方得到的平滑结算路径，不是假装取得真实月度行情。每次先结算当月回报，再从有余量的现金投入。知识不修改市场回报；它与分散、费用意识、开始投资和恐慌卖出的弱关联是游戏假设，另外有独立性格随机项。一般知识与学历不等于金融素养。本轮没有把群体统计换算成个人事件概率；将来加入统计型事件须标出原始资料、年份和口径。

## 输入与导出

游戏角色卡 version 2：name、age（本轮成人开局 18–90）、role、project、education、specialty、attributes。四属性含 value（0–100/null）及 source；AI 提示词只取最少且有依据的资料，不索取完整记忆、实际资产、疾病或他人信息。JSON 最长 16,000 字符，解析白名单字段、保留未知和依据、统一转义。旧 version 1 五分卡无法无损转换健康/金额，明确要求重新生成，不把旧余量分强行换成资产。

中英文复制和查看提示词共用 `cardPrompt(locale)`：先用当前对话和已有记忆；不足时允许只读工具在用户已经授权的开图工作区或记忆库中读索引、摘要和必要原文，不扩大权限、不扫描整个邮箱/云盘、不写资料。明确记录的年龄、职业、最高已完成学历和专业可以提取；不推断未记载的事实。读取失败与查过仍无记载分别说明，不能把没读当未知。输出的最多三行读取/事实依据说明位于 JSON 之外，现有解析器可接受；四属性的 source 保留“用户指定游戏设定”或“AI 游戏估计及事实依据”，缺项保留 null 与实际原因，不替模拟引擎填成 50。网页自身不连接资料库，仍是用户手动复制、导出、检查、粘贴。

游戏存档 version 2 保存种子、起始卡、决策和年度计划，重新验证并重放命令日志，不直接加载任意运行状态。PNG 只含游戏属性、模拟净资产和决策分叉，不含昵称、project、原始依据、年龄或种子。由用户主动下载，无上传、遥测、localStorage、账号或模型调用。

Kaitu 现有 `packages/core/src/onboarding.ts`（parseMemoryPaste/preview/confirm）与 `handover.ts` 已核对：真实记忆导入带 Node 文件系统、去重、来源和写入职责。这里仅复用“提示词→贴回→检查”的交互，不另造正式个人档案，也不从游戏分数重造事实。未来双导出应单独保留用户确认的真实源资料，分别导出真实开局资料与游戏记录；本轮不接入它。

## Remake 复用边界

审查基准：[VickScarlet/remake f04888e202e5dfca0df48c51b8a099dc03cf08b4](https://github.com/VickScarlet/remake/tree/f04888e202e5dfca0df48c51b8a099dc03cf08b4)，MIT；许可全文 `src/vendor/remake/LICENSE` 随 dist 分发。无原作事件文案、xlsx、UI 或 1in8b 素材/数值。原创 SVG 场景在 scene.ts。

- 保留 upstream 条件 DSL 与加权抽取工具，在 engine.ts 改造资格检查、效果和条件 branch。每个事件池拥有自己的 Map，生命线独立复制状态，不初始化原作全局数据。
- sample(worldSeed/lifeSeed, year, category) 是 32 位确定性有地址抽样；不靠两个顺序 RNG 保证共同冲击。原作默认 Math.random 在这里没有被使用。
- props 只含四属性；无 STAGE/PRACTICE/SHOCK。单一 role 代替互斥职业 flags，删除旧冲突 throw。删掉未使用的 NoRandom/exclude；weight 用于当前动态事件池，branch 保留扩展与循环保护。
- upstream 原始 data 构建缺 v-transform 的问题与全局 Maps 已在先前审查记录；本轮不安装或运行它，不声称重跑上游测试。

主要模块：card 输入；model 状态；finance 会计；market 共同行情/投资行为；events 原创池；decisions 玩家与因果；simulation 年度编排；app/scene/map 呈现与导出。事件库参数不混入正式 Kaitu schema。

## 验证约定

测试固定种子 acceptance-000…159，配对 0↔1、2↔3…158↔159，对每一种决策策略分别统计多重集重合率 `2 × 共同条目数 / 两局总条目数`。同时报告事件 ID 和去金额/人名后的完整正文；包含决策与后果事件，不能通过替换金额过关。通过门槛是固定 80 对的平均值低于 50%；最大单对也报告，不宣称每一对都低于 50%。同种子相同操作完整相等。

投资测试使用固定 investment-0000…0999，同市场、同初始金额、同持仓与性格，知识 25/85 配对；只通过行为与费用产生差别。报告均值、10/50/90 分位数、亏损人数、固定 10 个百分点分箱的分布重叠率；不能只看均值或给高知识市场溢价。账目、冷却、恢复、未知、存档、基线隔离和图片隐私另有行为测试。

自动测试不替代真人浏览器验收。实际结果、性能采样和截图只写 PR 描述/仓库外证据，当前点击验收由父线程安排的 Terra 负责。

设计原文：[v5](https://drive.google.com/file/d/1CB5C2CtX4zr5RiOSte7hVenRDddsUnpm/view)、[实跑报告](https://drive.google.com/file/d/15qElZZKHScNk5iOitRXvrWuKXUNryHJO/view)、[独立核对](https://drive.google.com/file/d/1ZZzpmhubpzw09AqbESw884YUu95y_dHX/view)。未来六世界内容 v2 保留在独立内容稿，本轮没有宣称已接入。

Character v2 now accepts optional `background` (completed qualification, field of study, industry, occupation, known work experience, evidence) and `starting` (game employment, experience, cash and deposits in simulated RMB). Old four-stat v2 cards and saves remain readable. Root `role` describes employment status; root `education`/`specialty` remain coarse rule tags. Original free text is preserved for review/export, not falsely advertised as separate specialized event logic. Explicit work experience affects income; a deliberate game override takes precedence. Unknown facts stay unknown; editable fallback assumptions live in `starting`, never in the source profile. Fenced JSON and surrounding prose are accepted without evaluation; ambiguous multiple cards are rejected. Failed input is retained for correction.

Desktop layout keeps the live year, pause/speed and next-choice action in a sticky time bar. The original scene is a 220–240px banner; next-year focus and pending decisions appear directly below. The right column separates simulated household, nonzero asset balances, annual income/expenses and expandable journal details. Viewing details pauses playback. A pending choice can collapse without advancing time, and decision callbacks reject a second activation after the choice is committed. Replay lives under the header More menu; an active run requires confirmation, with Cancel/Escape restoring the original playback state and untouched run.
