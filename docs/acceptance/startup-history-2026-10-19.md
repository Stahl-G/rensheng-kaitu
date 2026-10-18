# PR31：startup 历史漏记的复现与最小修复

基线 `dd399018bd6bff0587ffb29fdb64938b690fedc1`，分支 `codex/night-1019`。
本轮只处理 startup 后同长度、恢复精确 mtime 的历史漏记。飞书 PoC 暂缓。
原 PERF1、worker、错误码、chmod 预览冲突、健康导入、合法同名项目、长标题不重新验收。

## 复现及根因证据

原样使用父 `server-race.mjs` 的输入、15 ms 查询间隔和 2,200 ms 新版本等待上限。
仅替换模块定位和输出位置，全部写自己的 `/tmp` 合成目录，父目录保持只读。

- 基线原始三轮：3/3 未产生新版本，真实最新 Git blob 为 `before\n`，文件为 `after!\n`，`pending=[]`。
- 加 stat 轨迹的三轮：同一 ctime 整秒内的两轮失败，跨秒的一轮通过。
  两个失败样本中 polling 都读到修改后的 ctime 45 次，Git lstat 也各读到 3 次。
- 失败样本改写前后 inode、size、mtime 完全相同，ctime 毫秒不同而整秒相同。
  当前安装的 isomorphic-git `compareStats` 只比较 `mtimeSeconds` / `ctimeSeconds` 等字段，
  WORKDIR.oid 在匹配时直接返回索引里的旧 oid。运行轨迹与该缓存命中条件吻合。
- 新确定性用例只固定 Git 所见 ctime 的整秒部分，保留亚秒变化；polling 读取真实 stat。
  基线上它在真实 blob 断言失败：期望 `after!\n`，实际 `before\n`。

因此本次已证实的原因是事件到达后，Git 秒级 stat 快捷路径复用了旧内容。
没有证据证明监听接管漏事件，也不据此认定为 PERF3 引入。

## 改动

- `server.ts` 在有效文件事件进入后台调度时使对应历史路径失效；polling 与原生事件共用入口。
- `history.ts` 复用现有 fs 适配器，只在只读状态盘点中对失效路径及其目录子路径禁用 stat 快捷路径。
  占位时间只存在于该次状态查询，`refresh:false` 禁止它进入索引；实际 git.add 使用真实 stat。
- 每个失效路径有事件标记。成功核对为空或成功保存后，只消费本次检查过的标记，保留期间到达的新事件。
  核对为空也消费标记，避免无内容变化的事件导致后续一直重复读文件。
- 未增加树扫描、启动同步等待、全局锁、持久化摘要或每次全树 SHA；未改 plugin 文档写入、schema、PRD §6。

生产代码新增主要是路径失效与异步消费标记，测试仍只有两个业务用例：
普通外部编辑/删除/敏感排除，以及 startup 同秒恢复 mtime。两者都核对真实 Git 内容或树。

## 修复后的行为

最终检查结果、完整样本与 Git oid 见 [结构化证据](startup-history-2026-10-19.json)。

- 确定性回归：连续三轮通过，每轮两个业务测试；blob、mtime、版本数量断言均保留。
- 父报告同一有界时序：三轮通过，最新真实 blob、工作树、close 后 blob 均为 `after!\n`。
  另用 Git CLI 的 `git show HEAD:me/synthetic.md` 独立核对三份版本库，同样全部对齐，完整 oid 留在证据中。
- 正常监听请求与强制 polling 各三轮：startup 即时改写、普通编辑、删除、敏感状态排除、history HTTP 回读通过。
  本环境正常监听请求随后回退 polling，不能把这些样本写成真实原生事件持续运行通过。
- 合成原生事件直接投递三轮：不启动 polling，经过实际 server 文件事件回调、保存、history HTTP 和 close，均通过。
  它覆盖事件分支，不替代操作系统原生监听验收。
- 10k 合成文件中单文件改写：默认 1,000 ms polling 周期下，仅该文件被读取内容 3 次，其他 9,999 个合成文件为 0。
  真实提交 blob 为 `SYNTHETIC X\n`，没有恢复全树内容哈希。

额外边界：最初把上述 10k 内容读取探针配置成 30 ms refresh（实际最小 50 ms polling）时，
6 秒内没有观察到新 HEAD；close 后实际 blob 已追上 `SYNTHETIC X\n`，`pending=[]`。
保留此失败，不计为通过；未定位这个超高频配置的延迟原因，也没有放宽原小工作区 2,200 ms 验收上限。

## 10k 启动计时

10,000 个附加 Markdown，合成版本树 10,069 文件。模块加载、创建文件与基线提交均在计时外。
准备阶段最初逐文件 snapshot 太慢，停止自己的探针后，对同一合成目录批量 git.add 并提交基线，确认 pending=[] 再计时。
计时与全套测试分开运行，复用已打开的 Workspace，未连接真实宿主或外部日历。

| 请求模式 | listen 请求 ms（三次） | 首响应 ms（三次） | listen 前文件 stat | 实际 fallback |
|---|---|---|---|---|
| 正常监听请求 | 3.51 / 0.95 / 0.44 | 158.19 / 85.40 / 85.97 | 0 / 0 / 0 | 三次在首响应前已 polling |
| 强制 polling | 81.29 / 77.37 / 80.65 | 85.24 / 81.57 / 86.78 | 10069 / 10069 / 10069 | 三次 polling |

两组到首响应时均读了一轮 polling 元数据。正常请求 listen 前仍为零轮，强制 fallback 前置单轮。
未恢复 PERF3 已删除的两轮无条件全树 baseline。没有测 Electron 冷启动、Windows 或真实 App。
小工作区 history 请求三轮范围：正常请求 2.72–17.94 ms，强制 polling 3.23–8.42 ms。

## 检查与交付

- core-build：PASS，wall 3.516 秒。
- typecheck：PASS，wall 12.949 秒。
- biome：PASS，wall 0.468 秒。
- related-vitest：PASS，wall 14.448 秒。
- deterministic-repeat-2：PASS，wall 5.014 秒。
- deterministic-repeat-3：PASS，wall 4.740 秒。
- cli-build：PASS，wall 1.970 秒。
- 最终全套：90 文件 PASS、1 文件 SKIP、0 FAIL；267 测试 PASS、2 测试 SKIP、0 FAIL。
  Vitest 139.00 秒，命令 wall 139.936 秒，exit=0。完整阶段耗时留在结构化证据与原始日志。
- 全套使用独立合成 HOME，沿用之前只将 `/Applications/` 宿主判为不存在的 preload。
  两项既有可选宿主测试 skip；日历仅使用合成 executor，没有访问真实宿主或日历，未改测试逻辑。
- `git diff --check` 通过，schema / PRD §6 / 全局配置无改动。

全部证据为自己创建的合成资料，未读隐藏会话、真实资料/凭据/日历，未改全局配置。
原始脚本、运行日志、原始 stat 轨迹与合成 Git 对象保留在 `/tmp/kaitu-startup-evidence/` 及 JSON 所列目录。
本轮一个提交普通 push 到现有分支，不合并、不发版、不更新 PR 本身；PR31 报告供外层协调引用。
