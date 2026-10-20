# 固定源码检查与 PR54 依赖

功能源码固定提交：537c4ca2c1e8edb38e13dad708741b4a70e3234d。本报告后续只补许可/隐私文案、检查记录，不改变地图实现。最终head CI另见PR的精确SHA记录，未通过不得合并。

## 仓库必需检查

共享Mac工作树的部分旧文件经元数据核对为dataless，普通扫描/复制会等内容取回。使用 `git archive 537c4ca` 在 `/tmp/kaitu-footprint-check-537c4ca` 生成固定、完整的Git快照，所有workspace包指向该副本，复用已装依赖但缓存留在副本，不写主检出依赖。

- 完整 lint：534文件通过。
- 完整 `pnpm -r build`：通过；Vite原有大chunk提示保留，不当作错误或隐藏。
- 完整 `pnpm -r typecheck`：通过。
- 完整 `vitest run`：97个文件、286项测试全部通过，109.58秒；maxWorkers2、原testTimeout未变。

本地为macOS/Node26.11.1。pnpm11默认会自动校验并尝试重装复用的依赖目录，该操作被严格子目录保护拒绝；未使用force，也未更改原依赖。后续通过 `--config.verify-deps-before-run=false` 使用既有锁文件对应的安装，仅关闭副本中的自动重装行为，lint/build/typecheck/test内容未改。CI仍执行原 `pnpm install --frozen-lockfile`。

首次完整测试用默认沙箱启动，最小探针实测 `listen EPERM ... 127.0.0.1`，HTTP测试不具备运行条件；该运行已中止并保留日志。随后一次在允许隔离本机HTTP模拟服务的执行权限下完成286/286，不是扩大超时或反复跑到绿。

## PR54独立组合

PR54固定为4cc51db6c912ab6b4f5ed0ff819c84065109c7d6，其[自身双平台CI](https://github.com/Stahl-G/rensheng-kaitu/actions/runs/39273502190)已核实macOS/Windows均通过，不能替代PR65的CI。

将PR54相对其base 60ba38d052148d50039bced016dfb742f7585d67的packages差异应用到另一个537c4ca的Git快照：`/tmp/kaitu-footprint-pr54-combo-537c4ca`。补丁SHA256为3828f0059ef5580dffe0c6219964eabd3c422e2bd3e5b25e520611c7ae26112e，直接应用无冲突。副本未提交/推送、没有合并或复制到PR65分支。

组合检查：完整workspace构建通过；5项既有依赖相关用例通过（inbox第一项、onboarding第一项、SDK越界/链接拒绝、SDK实际写入编辑、飞书导入），另外17项按明确名称筛选未执行，未修改skip配置；足迹状态、A方向和现居共7项通过。共12项有针对性检查，不宣称组合全suite或组合Windows实跑。

具体依赖不是笼统“环境问题”：PR54修复Windows 8.3短路径/SDK长路径身份误判，以及Windows不直接执行npm.cmd的问题；同时将Workspace每次write/append同步重算overview改为按写入路径失效历史缓存，并保留snapshot阶段生成overview。

## 对原两项超时的进一步证据

此前精确main和较早PR运行的同一用例曾通过，f1303ca在同Windows镜像/Node版本下15秒超时，现有CI没有逐await分段计时，因此不能断言某次超时全部由主机波动或全部由overview造成。

在两个独立、相同的空合成工作区，先建初始snapshot，再执行正常 `addMemory({type:preference,name:language,text:用中文})`，临时计数仅存在/tmp测试脚本中：

| 指标 | PR65功能源码 | 隔离组合PR54 |
|---|---:|---:|
| refreshAfterWrite调用 | 2 | 0（该方法已移除） |
| 合成工作区内同步readFileSync | 186 | 66 |
| me/rules.md同步读取 | 126 | 44 |
| 单次观测耗时 | 99.9ms | 57.1ms |
| 最终版本数 | 2 | 2 |

两边记忆内容相同且版本均保存。该实验直接证明现有写入路径有重复同步读取，且PR54减少此负担并保留结果；它不是Windows超时的分段复现，单次Mac耗时也不作整体性能承诺。PR65不重复实现这项跨平台/写入路径修复。最终Windows CI若仍失败，保留实际失败项并维持不合并。
