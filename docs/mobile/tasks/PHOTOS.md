# PHOTOS：从照片找出去过的城市

仓库：iPhone 部分在 `kaitu-ios`，电脑部分在本仓库。版本：v0.7（不进 0.6.0）。设计稿：`docs/design/iphone/Photos.dc.html`。

## 要做成什么样

- 开图页的城市还很少时，出现一行「从照片找出你去过的城市」。点了之后请求相册权限，在后台读照片的拍摄时间和地点，几秒到十几秒后显示「找到 23 个城市、41 段经历，到电脑上核对」。
- 结果先进地图的「待核对」，用户确认后才画到地图上；整批可以撤销；「照片」这个来源可以整个关掉。
- 只读照片的时间和地点，不读图片内容、不看人脸；交出去的只有城市名、国家代码和日期，不交照片的精确位置。

## 不改数据格式

全部用现有的格式和流程：

- 手机交 `inbox/agents/ios-<设备号>-<ULID>.records.jsonl`，每行一条 `experience` 记录（`schemas/experience.schema.json`）。
- `fact_status: "inferred"`：不画在地图上，计入「待核对」（`experienceLayer` 对 inferred 返回 null）。**不能用 `suggested`**，那会被画成计划去的虚线。
- `source: "apple-photos"`：去重键是「来源 + 城市 + 开始日期 + 类型」（`places.ts` 的 `key`），重新扫描同样的照片不会重复；用户在足迹来源里排除这个来源，以后交来的都不收。
- 手机记录的 `origin` 不写 `user`（这是推测，不是用户说的），收件后署名 agent。

## iPhone

### 城市表

把电脑的 `packages/core/data/cities.json`（GeoNames，约 3.4 万个城市，2.6 MB）裁成手机用的一份：只留 geonameid、名字、中文名、国家、经纬度，打进 App。按 1°×1° 的格子建索引，查最近城市时只看周围九格，超过 50 公里算「附近没有城市」，这张照片不计。GeoNames 是 CC BY 4.0，在设置的开源许可里写明。

### 读照片

- `PHPhotoLibrary.requestAuthorization(for: .readWrite)`。选了「选中的照片」也照常做，结果页写一句「只读到你选中的 N 张照片」。
- 只取用户自己图库的照片和视频（`sourceType = .typeUserLibrary`，不含共享相簿），有 `location` 的才要；按 `creationDate` 排序。只读 `PHAsset` 的属性，不请求图片数据。
- 日期按手机当前时区换成本地日期。
- 整个过程在后台；界面立刻出现进度「正在看照片… 12,400 / 31,000」，可以取消。

### 归成经历

1. 每张照片 → 最近的城市 + 日期。
2. **住过**：某个城市在某个月里有 8 天以上拍过照，这个月算住在那；连续的这种月合成一条 `event_type: "lived"`，`time_precision: "month"`，`start` / `end` 写年月。
3. **去过**：其余照片按城市归成连续的停留，中间断开不超过 3 天的算同一次；只有 1 天且少于 3 张照片的去掉（多半是转机或路过）。每次停留一条 `event_type: "travel"`，`time_precision: "day"`。
4. 当前这个月不出结果（还没过完，下次扫描再说）。
5. 每条记录：

```json
{"type":"experience","origin":"assistant","fact_status":"inferred","source":"apple-photos",
 "event_type":"travel","time_precision":"day","start":"2019-05-02","end":"2019-05-06",
 "place":{"name":"京都","country":"JP"},
 "notes":"照片 46 张"}
```

手机只交 `place.name` 和 `place.country`；不得交 `geonameid`、`lat`、`lng` 或 `precision`，现有入口会拒绝这些字段。电脑用城市表解析城市中心；歧义或未知城市保留待核对。名字按界面语言取中文名或英文名。

### 交出和再次扫描

- 一次扫描写一个 `.records.jsonl` 交出，走现有的离线队列。
- 记下这次扫描到的最后一张照片的时间；设置里「重新从照片找」会重新算一遍全部（去重键保证不会重复），不做增量。
- 结果页：「找到 23 个城市、41 段经历」，下面按年列出前几条，按钮「好」。文字写明「已交给电脑，到开图的地图里核对后才会显示」。

### 权限文案

`NSPhotoLibraryUsageDescription`：

- 中文：读取照片的拍摄时间和地点，整理出你去过的城市，只存进你选的资料位置。不读取照片内容。
- English: Reads when and where your photos were taken to list the cities you have been to, saved only to the Kaitu folder you chose. Photo contents are not read.

只在用户点了「从照片找」时才请求，不在启动时请求。

## 电脑

1. 核对收件流程：手机交来的 `experience` 走 `addExperiences`（`inbox.ts` 里 experience 那一支），按批写入、能撤销；`inferred` 的不画，出现在地图的待核对里。写一个测试覆盖这条路。
2. 地图的待核对加「这批全部确认」：把同一批里 `inferred` 的改成 `observed`（按批），也保留逐条修改和删除。几十个城市一条条改不现实。
3. 足迹来源列表里显示「照片」，可以排除。

## 隐私和上架

- 隐私标签仍按「不收集数据」：结果只写进用户自己的资料位置。
- 上线前在 `kaitu.si/privacy/iphone` 加一段：读取照片的拍摄时间和地点用来整理城市，只交出城市和日期。
- `release.md` 的 C1 权限文案表加上这一条。

## 验收

- 合成：用一组带地点的合成照片（模拟器里导入，三个城市、一段住过加两次旅行、一张共享相簿照片、一张没有地点的照片），结果是 1 条住过加 2 条旅行；共享相簿和没地点的不计；电脑收件后地图不画、待核对里出现 3 条；「全部确认」后画出来；撤销这批后消失。
- 用户真机：用自己的图库扫一遍，记下照片数、耗时、找到的城市数，和自己的记忆对一遍，错的记下来调规则（8 天、3 天、50 公里这几个数）。
- 再扫一遍不产生新记录。
