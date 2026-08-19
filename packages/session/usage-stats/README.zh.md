# @deepseek-ai/dsh-usage-stats

[English](README.md) | 中文

跨会话的按天 token 用量统计，从持久化会话日志折叠而来，通过 Typert Remote 提供给客户端。日志即事实来源：每个 `assistant/message` 事件都携带该步骤的 token 计量，每个 `tool/call` 都带有工具名，因此聚合结果在重启后能从日志重新推导（回填历史），而不依赖进程内状态。

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
- 折叠是**增量的**：每次查询只折叠自上次折叠以来新增的事件（每个生命周期一个 seq 游标），所以重启后的第一次查询做回填，之后的查询很轻。
- 已从设备删除的会话仍保留其贡献——它的 token 确实被消耗过。
- 只读持久化日志；存活会话尚未落盘的尾部（最近几条事件）在写入前会稍有滞后。

## 组合

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

注入 `sessionPersistence` —— 这是该插件的全部用途；在没有它的组合里，fiber 会一直 pending，什么也不注册。

## 模型体验

无。该插件只是把已记录的会话事件计算成面向客户端的读模型，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；该插件从不组装或发送服务商请求。

## 已知限制与后续工作

- **重启后首次查询是冷回填** —— 聚合保存在内存里，所以重启后第一次 `stats` 调用会完整扫描一遍所有持久化日志；日志多且大时这是每个进程一次性的开销。持久化检查点能让重启即读，但会引入当前设计刻意回避的存储域。
- **没有按用途或按模型细分** —— 桶按 token 类型（输入 / 缓存命中 / 输出）细分，而不是按调用用途（对话 / 压缩 / 会话标题）或按模型，因为持久化的 `assistant/message` 记录不携带请求的 `purpose` 字段。要进一步细分需要先把该字段记入日志。
