# @deepseek-ai/dsh-usage-stats

[English](README.md) | 中文

跨会话的按天 token 用量统计，从持久化会话日志折叠而来，通过 Typert Remote 提供给客户端。日志即事实来源：每个 `assistant/message` 事件都携带该步骤的 token 计量，每个 `tool/call` 都带有工具名，因此聚合结果在重启后能从日志重新推导（回填历史），而不依赖进程内状态。聚合结果会被检查点化到 `usage_stats` 存储域，因此热启动会从持久化总量播种，只折叠增量部分，而非重扫每一条持久化日志。

## `usageStats` Remote

`ctx.usageStats` 是一个 Typert 远程服务，只有一个方法。

### `stats(request: { days }): Promise<UsageStatsValue>`

把每个会话新增的持久化事件折叠进按天总量，返回从最早到今天共 `days` 天的窗口。每个桶是一个本地自然日：

- `input` —— 完整提示输入：未命中输入加缓存命中（含 `cacheRead`）。
- `cacheRead` —— cache-read token（提示缓存命中——被复用的前缀）。
- `output` —— 输出（补全）token。
- `searches` —— 当天发起的 `web_search` 工具调用次数。

窗口长度被钳制到 `[1, 370]`；不可用值默认为 30。

### 折叠语义

- 聚合是**按日志（log-scoped）而非按接口（surface-scoped）**：后来被压缩对模型隐藏的 token 仍然计数，因为它们确实被消耗了。
- 折叠是**增量的**：每次查询只折叠自上次折叠以来新增的事件（每个生命周期一个 seq 游标），所以冷启动后的第一次查询做回填，之后的查询很轻。每个生命周期还有一个日志 revision，用于跳过自上次折叠以来日志未推进的会话，因此热查询完全不读那些未变化日志的文件字节。
- 聚合结果会被**检查点化**到 `usage_stats` 存储域：热启动（新进程、已有检查点）会从该域播种内存总量与逐会话折叠状态，然后只折叠增量；冷启动（没有检查点）则回填一次。检查点是单个全局记录，在每次有变动的折叠时原子写入；进程内仍以内存累加器作为热路径。
- 已从设备删除的会话仍保留其贡献——它的 token 确实被消耗过。
- 只读持久化日志；存活会话尚未落盘的尾部（最近几条事件）在写入前会稍有滞后。
- 无法读取的会话日志会告警、跳过，并且只在内存里记录其 revision——绝不写入检查点——因此损坏日志会在下次重启时被重试（并再次告警）。

## 组合

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
- id: storage-sqlite
  name: '@deepseek-ai/dsh-storage-sqlite'
  config:
    path: .../storages/usage-stats.db
- id: storage-domain
  config:
    backend: json
    routes:
      usage_stats: sqlite
```

注入 `sessionPersistence`（该插件的全部用途）与 `storageDomain`（检查点的存储形式）。检查点域通过 `storage-domain` 的 `routes` 路由到某个后端；web 组合把 `usage_stats` 路由到 SQLite 后端，而后者会在激活时急切打开数据库，这正是该行放在挂载本插件的 profile 而非共享 base 的原因。没有 `storageDomain` 的组合会在激活时响亮失败，没有 `sessionPersistence` 则 fiber 一直 pending。

## 模型体验

无。该插件只是把已记录的会话事件计算成面向客户端的读模型，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；该插件从不组装或发送服务商请求。

## 已知限制与后续工作

- **单个全局检查点记录** —— 检查点是单个全局值（累计总量加上逐会话折叠进度），以便原子落盘；每次有变动的折叠会整体重写该记录。介质是某个存储形式背后的检查点域，因此 schema 变更会提升域 `version`，而 SQLite 后端在打开时把它当作硬性的 `version-mismatch` 拒绝（它没有逐记录版本范围，也没有 `backupRecord`）。该数据完全可从日志重导出，因此恢复方式是清空该单元，而非做迁移。
- **重启后对损坏日志的重试** —— 损坏日志只会让可读会话被检查点化，因此每个新进程都会重试（并再次告警）损坏日志。在单个进程内它只告警一次并被跳过。
- **没有按用途或按模型细分** —— 桶按 token 类型（输入 / 缓存命中 / 输出）细分，而不是按调用用途（对话 / 压缩 / 会话标题）或按模型，因为持久化的 `assistant/message` 记录不携带请求的 `purpose` 字段。要进一步细分需要先把该字段记入日志。
