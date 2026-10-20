# 自用双云内容同步（桌面开源脚本）

这是作者手动运行的实验工具，独立于 iOS 产品。无后台服务、模型调用或云端 API；只读写两个已经下载到本机的文件夹。云端上传、手机收到与否仍由云盘负责。缓存文件可读并不能证明网络在线；脚本不声称能检测云端断网。

先在两边建立相同的普通内容副本，把要同步的相对路径写成 JSON 字符串数组（例如 `["projects/demo/STATUS.md"]`），保存在两云目录之外。只接受普通 Markdown / JSON / JSONL；显式列出的既有文件才会同步，新文件需另行审核加入新的共同基线。此版本不自动发现新文件。项目 `projects/<slug>/log.md` 是正式项目记忆，可以和 STATUS、notes 一起审核纳入。真正的 runtime/debug 日志仍排除。原始 Git、状态、认证、健康和 phone 快照不能进入双向清单。可识别的凭据与健康混合内容会停止整次预检，规则不是完整的秘密检测器，清单仍须先在本机审核。

```sh
python3 scripts/personal-sync/sync.py --left /path/to/drive-copy --right /path/to/icloud-copy --state /path/to/local-state --files /path/to/approved-files.json --initialize
# 确认预览后加 --apply 建立基线；之后省略 --initialize，先预览再 --apply。
```

首次建基线要求清单内每个文件在两侧都存在且内容相同。以后只有一侧改动就复制那一侧；双方改同文件时保留原件，并把两份内容保存在本机 `state/recovery/<相对路径>/`。同一冲突重复运行不重复保存。删除只报告 `missing-retained`，不删除另一侧，也不自动恢复；人工处理后两侧一致才更新基线。每次覆盖前也保存恢复副本；状态和恢复内容是私人资料，不要提交或分享。中途失败可能已有部分文件安全复制，重新预览再运行即可。中断遗留 `running.lock` 时先确认没有进程仍在运行，再人工移除。

不可用目录、未下载文件、符号链接或预览后变化会报错。不要在同一文件上同时运行其他同步脚本；没有跨进程/跨云事务或云盘文件锁。

手机快照另行单向刷新。先构建 core，再从 **iCloud 副本** 的批准内容在本地隔离目录调用正式生成器：

```sh
pnpm --filter @kaitu/core build
python3 scripts/personal-sync/refresh_phone.py --right /path/to/icloud-copy --state /path/to/other-local-generator-state --files /path/to/approved-files.json
```

刷新前应停止其他本机生成器。脚本不会读取 live source、不会把旧 phone 作为输入，也不运行 activate、资料迁移或 iOS 代码。用临时 config 接管副本格式，不生成任何记录或进度。health 数据完全不在暂存输入范围；schema 要求的健康空状态字段仍会存在。生成器时区沿用批准内容的 `me/rules.md`，缺少该文件时跟随运行环境 `TZ` / 系统时区。

验证：`python3 -m unittest discover -s scripts/personal-sync -v`。涵盖双向单侧编辑、预览、重复、冲突保留、删除保留、断开的目录、凭据阻断、范围限制与符号链接。真实云端离线/上传状态和手机端读取需要另行确认。
