# Codex 任务说明

给 Codex 的任务草稿，交接见 [HANDOFF §0](../HANDOFF.md)。运行：

```sh
codex exec -s workspace-write -C ~/Developer/rensheng-kaitu -o <结果文件> - < docs/briefs/<任务>.md
```

Codex 沙箱不联网。需要读 DeepSeek Harness 源码时，先由 Claude 克隆并切到 0.2.0-rc.2：

```sh
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git <目录>
git -C <目录> fetch --depth 1 origin tag dsh-v0.2.0-rc.2
git -C <目录> checkout dsh-v0.2.0-rc.2
```

再把 `<目录>` 写进任务说明。完成后由 Claude 审查、跑四项检查、提交。
