# 任务：统一财务模块 P0（数据层 + dsh Remote）

先读 `docs/prd-v1.0.md` 第 06 节（FR 11–13）与第 11 节「Account 与 Transaction」「HoldingSnapshot 与 Valuation」、第 14 节 AC 03 / AC 07；
再读 `docs/HANDOFF.md` §8、`packages/core/src/records.ts`、`importers/batch.ts`、`ui-imports.ts`、`modules.ts`、`templates/kaitu/projects/module.json`、
`packages/dsh-plugin/src/overview-service.ts` 与 `index.ts`、`packages/cli/src/mcp/server.ts`。
不联网、不提交、不加新依赖。只改当前 worktree，不碰 `~/kaitu`、`~/.dsh` 和 Google Drive。

## 范围

只做数据层和 dsh Host 侧 Remote 方法，不做界面。

1. **新模块** `finance`：`templates/kaitu/finance/module.json` + `STATUS.md`，`schemas/` 下新增所需 schema，`kaitu upgrade` 能给旧工作区补上。
   记录类型（名称可调整，字段遵循 PRD 第 11 节公共字段习惯，沿用现有 records 层的 id / rev / 版本）：
   - `finance_account`：名称、类型（cash / bank / wallet / securities / credit / loan）、币种、来源。
   - `finance_transaction`：账户、发生时间（带时区偏移）、**原币金额（十进制字符串，保留原精度）**、币种、类别（见下表）、对手方、说明、
     来源（`alipay-csv` / `manual` …）、来源交易 ID、关联交易 ID（退款→原交易、转账对端）、对账状态（`ok` / `pending_review` / `candidate_duplicate`）。
   - `finance_holding_snapshot`：账户、快照时间、证券代码、名称、数量、成本（可空）、价格（可空）、市值（可空）、币种、来源。
   - `finance_fx_rate`：日期、原币、目标币、汇率、来源。
   代码放 `packages/core/src/finance/`，从 `index.ts` 导出。金额一律用定点整数或字符串十进制运算，不用浮点相加。

2. **两种导入格式**（各一种，PRD 只要求 P0 各一种已验证格式）：
   - 账单：**支付宝导出 CSV**（GBK 编码，用 `new TextDecoder("gbk")`；文件头若干说明行，表头行为
     `交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注`，列名可能带空格，表尾可能有说明行）。
     `收/支` 为 `收入` / `支出` / `不计收支`；`交易状态` 含 `交易成功`、`退款成功`、`交易关闭` 等，交易关闭不入账。
   - 持仓：**同花顺 / 券商持仓导出 CSV**（UTF-8 或 GBK 自动识别），按列名识别 `证券代码`、`证券名称`、`股票余额`（或 `持仓数量`）、`参考成本价`（或 `成本价`）、`市价`、`市值`、`币种`；缺列时该字段为 null，不填 0。
   自己写小 CSV 解析（支持引号、转义引号、`\r\n`），不加依赖。

3. **先预览再提交**（复用 `.kaitu/cache/uploads/` 暂存方式，原文件只留在本机状态目录，提交或放弃后删除）：
   - `previewFinanceImport(ws, file, { format? })`：检测格式和编码、返回识别到的列 → 字段映射、期间（最早 / 最晚日期）、币种、前 20 行预览、
     将新增 / 已存在跳过 / 候选重复 / 待核对 的条数，以及无法解析的行（行号 + 原因），不写入。
   - `commitFinanceImport(ws, file, { mapping?, account })`：用户可覆盖字段映射；整批校验后写入，一次导入只存一个版本，`by` 为 `import:alipay-csv` 之类。
   - **幂等（AC 03）**：同一文件重复提交不产生新记录、不存新版本。去重键优先 `来源 + 来源交易 ID`，没有时用内容特征（账户、时间、金额、币种、对手方、说明）。
     **不同来源**的同一交易（例如手记的和支付宝导入的同额同日）不合并，标 `candidate_duplicate` 并互相关联，等用户核对。

4. **记账口径（AC 07）**，写成纯函数，导入和汇总都用它：

   | 情形 | 口径 |
   |---|---|
   | 银行卡转入证券账户 / 账户间转账 | 类别 `transfer`，不算收入或消费；同额、相反方向、3 天内的两条自动配对（互相关联）；只有一边或疑似转账（支付宝的「转账」「提现」「充值」、`不计收支`）标 `pending_review` |
   | 卖出证券 | 卖出款拆为 `principal`（本金，按成本）和 `realized_gain`（已实现收益）；**没有成本时已实现收益为 null，本金也为 null，并说明缺成本**；卖出款永远不进「收入」 |
   | 分红 / 税费 / 手续费 | `dividend`、`tax`、`fee` 独立记账；收益结果注明是否已扣费 |
   | 退款 | `refund` 关联原交易，冲减原消费，不算收入；找不到原交易标 `pending_review` |
   | 借贷 | `loan_in` / `loan_repay` 本金独立于收支，`interest` 另记 |
   | 多币种 | 保留原币；有 `finance_fx_rate` 时给出折算金额、汇率来源和日期；没有汇率时该项标 `fx_missing`，不折算、不计入折算后合计（合计旁列出缺汇率的项） |
   | 仅有持仓快照 | 不推算期间现金流和收益率；未知项为 null |

5. **四个视图的数据函数（FR 11 / FR 13）**，每个数字都带组成它的记录 ID（下钻），并给出统计区间与截止时间：
   - `financeOverview`：现金、投资资产、负债、**总资产**与**净资产**（分开命名），按币种分组，可选折算币。
   - `financeCashflow(from, to)`：收入、消费、结余；另列「投资资金流」「收益」两类口径，与收支分开（PRD 的四类口径）。
   - `financeInvestments`：最新持仓、成本、估值、分红、已实现 / 未实现收益；收益率只在数据齐全时给出，并写明算法（例如「简单收益率 = 收益 / 成本，未计时间加权」）；缺什么就返回 null 和缺失原因。
   - `financeAccounts`：币种、余额（仅能从快照或流水确定时给出，否则 null）、关联交易数、最近导入时间（同步状态）。

6. **dsh Remote**：在 `packages/dsh-plugin/src/` 新建 `finance-service.ts`（单独一个 TypertRemoteService，不改 `overview-service.ts` 的已有方法，主会话正在改它），
   暴露 `financeOverview`、`financeCashflow`、`financeInvestments`、`financeAccounts`、`financeImportPreview`（接收文件名 + base64 内容，暂存后预览）、
   `financeImportCommit`、`financeImportDiscard`，全部调用 core；在 `index.ts` 注册，按现有构建脚本生成 codec。

## 安全

- 不写任何登录、Cookie、交易密码相关字段或代码；没有下单、转账功能。
- MCP `remote` 集合（`packages/cli/src/mcp/server.ts`）里 `record_list` 和 `read_file` 不返回 finance 模块的明细；`all`（本机 stdio）照常。
- 测试和示例只用合成数据（虚构对手方与金额）。

## 测试

只写一个 `packages/core/test/finance.test.ts`，覆盖：
- 同一支付宝 CSV 预览不写入；提交两次第二次零新增、无新版本；手记的同一笔标候选重复（AC 03）。
- 转账配对不算消费、卖出缺成本时收益为 null 且不进收入、退款冲减原消费、缺汇率不折算（AC 07）。
不写断言文案的测试，不为常量或 CSV 解析细节单独写测试。

## 文档

`docs/finance.md` 一页：支持的文件、导入步骤、记账口径表、哪些需要真实文件验证。HANDOFF §8.1 加 3–5 行进展。

## 完成标准

`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过。用中文汇报三到五行：做了什么、Remote 方法清单、哪些只能用真实账单验证。不写免责声明。
