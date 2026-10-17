# 独立 Web 引擎、日程减重与动态模型列表

日期：2026-10-17。基准：`b1ff2ad4ec3f13bc9a9dad536c0fc4cfa82697ed` 加本工作树未提交整合改动。
未提交、未推送、未发布 npm，未做 Developer ID 签名或公证。

| 项目 | 结果 | 证据与边界 |
| --- | --- | --- |
| CLI/Web 独立 Node 引擎 | 通过启动验证 | 候选包安装在临时前缀后，以 Node 启动 DSH SDK，initialize 返回成功，不读取 Kaitu.app，也没有发送模型请求 |
| 模型动态获取 | 通过公开接口运行验证 | 最终安装包的本机 askModels 接口返回 HTTP 200、468 个 OpenRouter 模型 |
| DeepSeek 不预填型号 | 通过界面检查 | 模型输入初始为空，可获取列表或手填，没有固定型号白名单 |
| DeepSeek 带 Key 拉取与真实回答 | 未验证 | 未输入或读取用户凭据；无 Key 请求显示权限提示，保留手填入口 |
| Gemini 列表适配 | 合成接口验证通过 | Gemini 形状的本机接口返回新模型 ID，过滤不支持 generateContent 的条目；不代表真实 Gemini 账号验证 |
| 待确认日程减重 | 通过网页视觉检查 | 待确认日程只列一次，小型浅靛蓝确认按钮，其他核对保留摘要链接 |
| 本机 App | 已安装，原生验收未完成 | 已更新 /Applications/Kaitu.app；Computer Use 原生控制连续超时，不能据此声称原生界面验收通过 |
| 跨平台与发布 | 未做 | 本轮只验证 macOS 本机候选安装；未验证 Windows/Linux、未公开发布 |

## 实现

- CLI/Web 声明固定版本 DSH 0.2.0-rc.2 运行时依赖，安装时由包管理器一起安装原生依赖。
  产物包含 CLI、网页、开图工具及适配代码；不是把所有跨平台依赖物理装入单个离线归档。
- 所有服务均请求其模型 API，DeepSeek 请求 `https://api.deepseek.com/models`。
  已保存型号保持原值；新连接不预选型号；允许手填服务端支持的模型 ID。
- DSH 内置目录仅补充 API 已返回型号的图片能力，不作为可选模型清单。
- “今天的日程”承载待确认项的确认/不用操作，移除重复列表。
  保留 Slate Indigo 品牌、暖白背景和主卡片墨色动作。

## 运行与产物

- 新预览：<http://127.0.0.1:4884>，使用独立临时工作区。
- 4883 原预览保持运行，避免打断用户可能尚未保存的连接表单；该页还是旧模型界面。
- 安装包：`dist/rensheng-kaitu-0.1.0.tgz`，安装说明：`docs/web.md`。
- 临时安装根目录：`/private/tmp/kaitu-web-install-4z17mv51`，最终前缀为 `release/`。
- Node 引擎启动回执：`/private/tmp/kaitu-web-install-4z17mv51/engine-result.json`。
- 本轮执行必要构建与实际运行检查，没有增加静态断言测试或重跑全套测试。

## 截图

网页合成资料的日程布局（不是原生验收截图）：

![日程减重](../../dist/e2e/web-tonal/tonal-agenda.png)

DeepSeek 未填 Key 时的模型入口，截取时“获取列表”按钮尚未应用最后补上的既有按钮样式：

![动态模型入口](../../dist/e2e/web-tonal/deepseek-model-picker.png)

## 待用户检查

在新 App 或 4884 页的“问问 → 连接 AI”亲自填写 Key，获取并选择所需模型。
不需要将 Key 发到聊天里。原生窗口控制恢复后再补原生视觉验证。
