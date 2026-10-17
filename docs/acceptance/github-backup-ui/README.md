# GitHub 备份界面点击验收

浏览器：本机 Chromium Headless Shell build 1243，Playwright 驱动；使用独立浏览器上下文、临时工作区与合成资料。加载实际构建的工作台 UI，调用实际本机资料服务。只有发往 GitHub 的请求改用内存 mock，未填写 token 或创建授权。这是界面路径验收，不是真实 GitHub 往返。

| 操作 | 结果 | 截图 |
|---|---|---|
| 个人菜单 → AI 与连接 → GitHub 备份 | 入口、类别开关与恢复入口可见 | [连接入口](01-entry.png) |
| 连接 synthetic/public | 明确公开提示，上传未开启，mock 无提交 | [公开警告](02-public-warning.png) |
| 连接 synthetic/private → 立即同步 | 状态更新；手动同步不重复查可见性、不产生空提交 | [私库状态](03-private-connected.png) |
| 连接 synthetic/offline | 提示失败，本地合成资料仍可保存 | [失败提示](04-sync-failure.png) |
| 从 synthetic/restore 恢复 | 新目录出现合成文件，可继续打开 | [恢复结果](05-restored.png) |
| 打开恢复工作区 | 当前工作区切换，token 输入仍为空 | [打开结果](06-restored-open.png) |

浏览器脚本错误为 0。GitHub mock 只收到 4 次仓库信息查询（公开连接、私有连接、离线连接、恢复各一次），手动同步没有额外查询。截图内容均为合成数据。
