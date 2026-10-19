# 私人项目记忆提示词验收

## 本机入口检查

本机 2026-10-19 检查：两个仓库根 package.json 均无 `kaitu` script；`pnpm kaitu --help` 实际落到 `~/.local/bin/kaitu`，错误是缺失 `rensheng-kaitu-runtime/packages/cli/dist/main.js`。直接源码入口 `pnpm --dir packages/cli exec node dist/main.js --help` 可用。没有修改该全局包装器；用户更新后应重新探测，不能根据旧检查假称已修复。

## 既有合成文件链

基线 PR40 `7f7ea1b` 使用普通 Git、fake gh 和本地 bare 远端执行 32 条命令，完成两克隆接续；现有 STATUS/module schema 校验通过。未创建真实 GitHub 仓库、未安装 runtime、未调用 App/kaitu、未上传真实资料。该结果不是两个真实模型 Agent 的验收。

## 两个全新模型 Agent

用户在模型 Agent 启动前决定亲自用 Codex/Claude/Devin/Cursor 测试，因此本轮没有启动新的自动模型 Agent。仅准备临时合成夹具，未访问真实 GitHub、未创建真实测试仓库、未设置 OAuth。

人工测试设计：只由第一个 Codex 初始化一个私人测试记忆库；其他 Agent 使用独立 clone 目录和新会话串行接续。每次核对来源、失败尝试、阻塞、完整下一步、follows 以及远端提交，再进入下一个 Agent。结果待用户实测。

可选最后测试两个 Agent 同时追加唯一交接文件；仅能按实测说明唯一文件创建、推送拒绝或实际处理过程，不称完整并发合并已经验证。

## 最新用户范围

用户改为亲测现有真实 ai-memory，具体是否 my-ai-memory、目标项目和接收 Agent 仍待本人确认。主要验收是两个全新 Agent 对同一获准项目的独立只读理解，之后再由用户指定真实小任务和写回。维护者不读取、上传或转发真实资料，不创建新测试仓库，不重铺模板；此前合成顺序仅是历史开发设计，不作为最终验收。入口已改为复用已有库，待用户确认后由用户亲自执行。
