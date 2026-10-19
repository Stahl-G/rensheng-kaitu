# 原始网页冷读封存
- 首次取时：2026-10-19 20:21:32 UTC；首次 curl 响应时间 2026-10-19 20:22:06 UTC。
- https://kaitu.si/developers：web.open 返回 not accessible；curl --fail 返回 HTTP 403（退出 22），保留 developers.headers。再次不带 --fail 请求 CONNECT tunnel failed, response 403（退出 56），保留 developers-retry.headers。
- 当前线上 HTML 与提示词正文均未取得，不以仓库 README 的提示词充当线上原文。原始网页冷读在入口阻塞。
- 原版提示词无法执行；下面的本地实验是仓库公开说明替代路径，不能计为网页冷读成功。
- 按用户要求，全部资料合成、目录临时；GitHub 私库创建、账号登录、项目 PR/issue API、iPhone 真机均不验。真实普通本地 bare Git 只验证文件与 Git 行为。
- 仓库 main 起点 e2d9cd83a176bf2fc6b35bc1dabe7f92f32bc9d6，已 git fetch origin main；独立 worktree 与分支 codex/v3-cold-read-20261019。
- 未读实现源码前读取仓库开发约定（AGENTS、GOAL、PRODUCT、HANDOFF）及公开 agent-memory README、INSTALL、ADD_DEVICE、DATA_LOCATIONS、模板入口与项目技能。
- 此时 git、官方 gh、Node 可用，kaitu 命令不存在；选 INSTALL 第 7 步的「没有 kaitu」路径。手机内容按原版第 8 步明确跳过，不能记为生成成功。
