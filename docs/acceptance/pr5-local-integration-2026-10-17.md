# PR #5 本地整合

目标：让用户直接记录、查看和推进，减少格式要求、冗长正文与额外操作。

基准：PR #5 `b1ff2ad4ec3f13bc9a9dad536c0fc4cfa82697ed`。
本地分支：`codex/pr5-local-integration`，叠加未提交的家乡与方向反馈修改及本轮修复。
没有提交、推送、远端合并或发布。旧验收报告及证据保留。

## 整合内容

- 保留 PR #5 的宽容导入、资讯采集说明与界面调整。单位由 Agent 理解，不增加单位校验。
- 家乡直接输入城市保存，不再要求单独调用 AI 识别。
- 方向一条一行，显示短标题、原因与第一步。生成提示词要求简短，不强制搜索论文。
  正文隐藏内部路径、哈希、裸链接，参考资料留在详情。
- 健康并列列表走与样本数组相同的时间和字段处理，空行不会拖累有效样本。
  复用现有写入预览逐条筛掉无法保存的健康记录，没有新增校验规则。
- MCP 资讯来源留给发布网站，采集 Agent 写入 `via`，与收件箱一致。

## 实际验证

仅用 `/private/tmp/kaitu-pr5-integration-xkjP86` 下的合成工作区及独立状态目录。
构建和打包完成。未运行 lint、独立 typecheck、测试套件，未新增测试文件。
构建自身包含 TypeScript 编译，不作为行为验收结论。

| 操作 | 结果 |
|---|---|
| 含坏日期的健康文件预览、导入 | 有效记录保存，坏样本计入忽略 |
| 并列列表省略时区 | 按工作区时区处理，成功导入 |
| 并列列表夹空值、数组夹非法症状值 | 跳过坏样本；已存在的有效数据保持去重 |
| MCP 写一条只有标题和 URL 的资讯 | `source=example.org`、`via=codex` |
| 浏览器方向采纳 | 显示“已保存”和“在试” |
| 浏览器输入北京并保存家乡 | 显示家乡起点与地图标记 |
| 打包 App 原生窗口采纳方向 | Computer Use 点击成功，显示“已保存”和“在试” |

运行记录：[runtime.json](../../dist/e2e/pr5-integration/runtime.json)。
截图：[原生方向列表](../../dist/e2e/pr5-integration/native-directions.png)、[家乡起点](../../dist/e2e/pr5-integration/hometown.png)。
本轮为聚焦整合走查，未重跑 A–G 全量验收，也未调用真实模型评估新提示词输出。

## 本机交付

已替换 `/Applications/Kaitu.app` 并启动，版本仍为本地预览 `0.1.0`。
旧 App 移入废纸篓，打包目录不留第二份 App。
只有本机运行所需的 ad-hoc 签名，没有 Developer ID 签名或 Apple 公证。
安装记录：[install.json](../../dist/e2e/pr5-integration/install.json)。
