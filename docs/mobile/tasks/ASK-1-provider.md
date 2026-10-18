# ASK-1：选接口库，做 ChatProvider

规范：[../ask.md](../ask.md) §3。仓库：`kaitu-ios`，放在 `KaituKitData`。

## 目标

在 MacPaw/OpenAI 和 llmkit-swift 之间选一个，包成我们自己的 `ChatProvider`，用你的 DeepSeek Key 跑通流式回答和一次工具调用。

## 做什么

1. 两个库各写一个最小例子：流式输出一段回答；带一个假工具 `echo(text)`，模型调用后把结果放回去再答一次；中途取消。
2. 按 ask.md §3 的五条标准打分，结论写进 PR 说明（附许可证链接和最近发版日期）。选中的那个加进 Swift 包依赖，另一个的例子删掉。
3. 定义协议（名字可以调整，结构保持）：

```swift
protocol ChatProvider {
    func stream(_ messages: [ChatMessage], tools: [ToolSpec]) -> AsyncThrowingStream<ChatEvent, Error>
}
enum ChatEvent { case text(String), toolCall(id: String, name: String, arguments: String), done }
```

4. 服务商配置：DeepSeek（默认）、Kimi、智谱、OpenAI，各自的服务地址和默认模型写成一张表；模型名在 PR 里写明是用真实 Key 确认过的。
5. 错误分成：Key 不对、额度用完、限流、网络、服务商其他错误；保留服务商原始信息给界面显示。

## 不要做

- 不写 Agent 循环（ASK-2 做）。
- 不在代码或日志里出现 Key；测试用环境变量，CI 里没有 Key 时跳过真实请求的测试。
- 不引入除选中库以外的网络或 JSON 库。

## 验收

- 单元测试：用假的服务端回复覆盖流式拼接、工具调用解析、取消、五类错误。
- 真实 Key 的手动测试截图或日志（去掉 Key）放进 PR。
