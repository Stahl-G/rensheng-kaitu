# 财务 P0：本机数据与 dsh Remote

支持支付宝导出 CSV（GBK，兼容 UTF-8）和按列名识别的同花顺 / 券商持仓 CSV（UTF-8 / GBK）。
支付宝可包含说明行、空格列名和表尾说明；关闭交易跳过，未完成或损坏行显示行号与原因。
持仓识别证券代码、名称、数量、每单位成本价、市价、市值和币种；缺列保留 null，证券代码保留前导零。
没有快照时间列时采用上传文件时间；同文件再次上传仍按内容去重。新工作区自带 finance，旧工作区运行 `kaitu upgrade`。

导入顺序：先用 `finance_account` 建立账户，再上传文件并调用 `previewFinanceImport` / `financeImportPreview`。
预览返回编码、列映射、期间、币种、前 20 行、新增 / 跳过 / 候选重复 / 待核对计数及错误行，不修改业务数据。
预览传 account 可准确核对无交易 ID 的记录；未选账户时计数供初筛，提交会按最终账户重新计算。
映射为「字段名 → 列名」，null 忽略列；修改映射后可重新预览，提交时也可覆盖。
确认后 `commitFinanceImport` / `financeImportCommit` 整批校验并存一个版本；任何错误整批不写。
原件仅放本机状态目录的 `.kaitu/cache/uploads/`，成功提交或 discard 后删除；失败保留以便修正。
相同来源交易 ID 优先去重，无 ID 用账户、时间、原币金额、币种、对手方与说明；跨来源疑似重复保留双方并互相关联。
重复提交不新增记录或版本；金额始终为十进制字符串，计算用 BigInt 定点运算。

| 情形 | 记账口径 |
|---|---|
| 转账、提现、充值、不计收支 | transfer 不计收支；跨账户同币种、相反金额、3 天内唯一匹配互相关联；方向未知、单边或多候选待核对 |
| 卖出证券 | sale 不计收入；本金为所售证券总成本，已实现收益为卖出款减成本；缺成本两项均 null |
| 分红、税费、手续费 | dividend / tax / fee 独立；收益另列费用覆盖状态，不假定已扣全部费用 |
| 退款 | refund 关联原消费并冲减消费；无法唯一匹配或累计超原额待核对，不计收入 |
| 借贷与利息 | loan_in / loan_repay 本金不计收支；interest 单列并计入资金使用成本 |
| 多币种 | 原币分组；使用估值 / 交易日之前最近直接汇率，列出实际汇率日期、来源及记录 ID；缺汇率 fx_missing，不进入折算合计 |
| 持仓快照 | 已知数量和成本价可计算总成本，已知数量与市价可计算估值；未知项 null，不推算期间现金流或收益率 |

`financeOverview` 分列现金、投资资产、负债、总资产及净资产；证券账户现金与持仓分别计入。
`financeCashflow` 接受本地日期 from / to，分别返回收支、投资资金流和收益。
`financeInvestments` 返回账户最新整批快照、成本、估值与收益；快照简单收益率明确未计时间加权、分红与费用，期间收益率缺完整现金流时为 null。
`financeAccounts` 仅在有 balance / balance_at 余额锚点时按后续流水计算余额，否则 null；返回交易数、最近导入和同步状态。
各视图给出统计区间、截止时间和组成指标的记录 ID，折算合计列出未计入项。
本机 stdio MCP 可读明细；remote 集合的 record_list / read_file 屏蔽 finance 模块（包括工作区内符号链接）。

Host Remote 服务为 `kaituFinance`：financeOverview、financeCashflow、financeInvestments、financeAccounts、
financeImportPreview（文件名 + base64）、financeImportCommit、financeImportDiscard。没有界面或外部账户操作。
