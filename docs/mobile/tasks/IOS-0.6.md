# IOS：0.6.0 收尾（10-22 交 TestFlight）

仓库：`kaitu-ios`。按顺序做；宽屏改版单独在 [WIDE-duo.md](WIDE-duo.md)。

## IOS-0 先把本地推上去，记基线

远端最新是 `codex/orca-ios-development`（`ca07118`，0.6.0 build 4，main 落后 2 个提交）；用户模拟器里的 0.7.0 (6)（四个标签、顶部胶囊、资料页、问问页）没有推到任何分支。

1. 把本地所有提交推到远端分支（不 force push）；有没提交的改动先提交。
2. 从这个分支切出今晚的分支（见夜间计划的「分支」）。
3. 跑一遍现有测试和 `scripts/measure-simulator.py`，记下：测试数、通过数、冷启动显示今天的耗时、Duo 内屏和外屏截图。写进晨报，作为今晚改动的对照。

验收：GitHub 上能看到和用户模拟器里一样的代码；晨报里有基线数字。

## IOS-1 跟上手机格式：generator 和资料目录

格式已经用户确认（2026-10-18），见 `rensheng-kaitu` 的 `schemas/phone-*.schema.json` 和 `docs/guides/phone-contract.md`。

1. 把 `rensheng-kaitu/schemas/fixtures/phone/` 的样例（含新的 `library.json`，today/week/map 多了 `generator`）拷进 `KaituKit/Tests/KaituKitTests/Fixtures/`，解码测试跟着更新。
2. `today`、`week`、`map` 解码可选的 `generator: {kind, name?, spec?}`；没有这个字段当作电脑生成。
3. 状态文案按 product §5：「Dot 07:30 更新」/「电脑 07:30 更新」；今天由 Agent 生成时，在路上的原文和操作写「已记下，等 Dot 处理」，手机记录仍写「等电脑处理」（agent-runner I14）。一周卡片和开图页的生成者或日期与今天不同时写「电脑 10-16 的数据」（I11）。
4. 状态位和状态行读同一个计算属性（WIDE W4「说法只有一个来源」）。
5. 资料页的列表和搜索改读 `phone/library.json`（`items` 的 kind / title / subtitle / date / path / id），点开哪一项才读那个文件。现在如果是别的来源（扫目录、拼快照），换掉。没有 `library.json` 时显示「电脑上的开图更新后，这里会列出资料」。

不要做：不改格式，不给缺字段的情况写兜底分支（schema 里必填的就当它有）；解码失败按现有的「快照版本过新 / 读不懂」提示处理，不另写一套。

验收：样例全部解码；去掉 `generator` 的 today 显示「电脑 … 更新」；Debug 合成工作区里资料页列出样例的 7 项，点开项目能看到 `STATUS.md` 内容。

## IOS-2 宽屏改版

见 [WIDE-duo.md](WIDE-duo.md)。顺序：W4（开图满屏 + 状态只留一处）→ W1 今天 → W2 资料 → W3 问问。

## IOS-3 上架准备（release.md）

1. **首发不带问问**（用户 10-18 决定，隐私政策也按不带问问写）：Release 构建隐藏问问标签（编译条件，例如 `#if DEBUG` 或单独的 `KAITU_ASK` 标志），Debug 照常显示。隐藏后标签只有今天、开图、资料三项，宽屏胶囊同样三项。
2. **权限说明文案（C1）**：健康、日历、麦克风、语音已有中英文；对照下表改成这版文字，只保留代码里真的会请求的那几条：

| 键 | 中文 | English |
|---|---|---|
| `NSHealthShareUsageDescription` | 读取训练、睡眠、步数和身体指标，写进你选的开图资料位置，用在一周近况里。开图没有服务器，看不到这些数据。 | Reads your workouts, sleep, steps and body measurements and writes them to the Kaitu folder you chose, for your weekly summary. Kaitu runs no servers and cannot see this data. |
| `NSCalendarsFullAccessUsageDescription` | 你在开图里确认的日程，会写进 Apple 日历里的「开图」日历。 | Plans you confirm in Kaitu are added to the "Kaitu" calendar in Apple Calendar. |
| `NSSpeechRecognitionUsageDescription` | 把你按住说的话转成文字记下来，优先在手机上识别。 | Turns what you say while holding the button into text. Recognition runs on this iPhone when possible. |
| `NSMicrophoneUsageDescription` | 按住说话时录音，用来转成文字。 | Records while you hold the button, so your words can be turned into text. |
| `NSCameraUsageDescription` | 拍一张照片记下来，存进你选的资料位置。 | Takes a photo to save in the Kaitu folder you chose. |

   - 选照片如果用的是 `PhotosPicker`，不需要相册权限，不加 `NSPhotoLibraryUsageDescription`。
   - 日历：只写不读的话可以改用只写权限（`NSCalendarsWriteOnlyAccessUsageDescription`）；但新建「开图」日历可能需要完整权限。按代码实际调用选一个，Grok 核对苹果文档后定。
3. **Key 和 token 只在钥匙串（C3）**：搜一遍 GitHub token、AI Key 有没有进 `UserDefaults`、日志、崩溃信息、快照或收件箱文件；有就改。
4. **拒绝权限后照常可用（C2）**：拒绝日历 → 确认的日程只记在开图里；拒绝健康 → 不同步健康；拒绝语音 → 只能打字。逐条在模拟器里点一遍，结果写进晨报。
5. `ITSAppUsesNonExemptEncryption = NO` 已有。
6. **补 `PrivacyInfo.xcprivacy`**：UserDefaults、文件时间戳等需要声明原因的 API，不补会被 ITMS-91053 拦下。
7. 旧同步地址带 `?key=` 明文存在 UserDefaults（`AppSettings.swift:11`）：挪进钥匙串。
8. 健康模块的报错文字补英文（`SyncEngine.swift:13-17`）。

不要做：不上传 App Store Connect、不提交审核、不改 Bundle ID 和签名设置。

## IOS-4 示例资料（审核员和第一次打开的人都要用）

release.md R3。审核员没有电脑和资料位置；首批试用的人也要在 10 分钟内看到一个完整的样子（launch.md §1a G1）。

1. 首次使用页加「看看示例」：用 App 里内置的一份合成工作区（就是 `schemas/fixtures/phone/` 那一套，加几篇样例原文和 `STATUS.md`，让资料页点得开），只读。
2. 示例模式下顶部一直显示「示例资料」；「记一下」只存在手机本地，不交出；设置里「离开示例」回到首次使用。
3. 审核备注要写的入口路径，写进 PR 说明（设计会整理进 release.md S6）。

验收：删掉 App 重装，不选资料位置，点「看看示例」能走完今天、开图、资料三页，宽屏同样。

## IOS-5 清理

代码审查（2026-10-19，按 `ca07118`）找到的，按顺序：

1. 队列只增不删：回执落定、新快照覆盖后删掉条目；`pendingAction` 不要每行线性扫（`PhoneRepository.swift:87-96,154`、`PhoneModel.swift:267-274`）。
2. 主线程 I/O：`SyncEngine` 的编码和写 iCloud、书签解析、读队列挪到后台（`SyncEngine.swift:54,92,121`、`PhoneModel.swift:111,123-138`）。
3. 日历写入挡在点按上：先入队、立刻反馈，日历在后台写（`PhoneModel.swift:238-251`）。
4. 健康后台投递：completion 在同步完成后再调，补 `com.apple.developer.healthkit.background-delivery` entitlement（`HealthCollector.swift:281-285`）。
5. 宽屏改成单树后删掉补丁：`RetainedScroll.swift`、`mapOpened` / `layoutChanged` 标志、720 / 900 的宽度上限。
6. `FirstFrameGate` 等两帧才读缓存，去掉；过时的验收文档更新。
7. 多余的防御：伪造的 `http(422)`、文件已存在时去远端逐字节比对、每次启动重验仓库名、MainActor 里的 `MainActor.run`。
8. 重复：三份「写入测试文件」、三份按收件方式的 switch、三个一样的 HealthKit 查询、两套书签存储，各合成一份。
9. 死代码：`OnboardingView.swift`、写死的版本号 "0.6.0"、旧容器名。
10. 一个快照解码失败就全部清空：改成各管各的（`PhoneModel.swift:187-192`）；`PhoneModel` 换成 `@Observable`。

原则：能删就删；不为不可能的情况写分支；同一件事只校验一次；没有调用者的抽象删掉。每处改动单独一个提交，说明删了什么、为什么安全。

## IOS-6 截图（最后做）

用示例资料截：iPhone 6.9 英寸（iPhone 17 Pro Max）、6.5 英寸、iPhone Duo 外屏和内屏，今天、开图、资料三页，中英文各一套，放 `docs/acceptance/screenshots/0.6.0/`。需要的尺寸以 App Store Connect 当前要求为准（Grok 核对）。
