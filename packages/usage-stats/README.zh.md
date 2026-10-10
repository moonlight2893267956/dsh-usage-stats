---
description: "跨本设备所有会话的按天 token 用量总量，从持久化会话日志折叠而来，并通过一条只读 HTTP 路由提供给客户端。"
kind: "package-reference"
---

# @moonlight2893267956/dsh-usage-stats

[English](README.md) | 中文

## 概述

用这个包报告本设备花了多少 token，按天聚合、覆盖所有会话，而不只是当前打开的那一个。它把持久化会话日志折叠成按天的输入、缓存命中、输出 token 总量以及网络搜索次数，并通过一条只读 HTTP 路由提供给客户端。因为日志就是事实来源，总量能跨重启存活并回填历史；存储检查点让热启动只折叠新事件。已删除的会话保留其贡献，无法读取的日志会被跳过而不是让查询失败。

## 安装

装进 profile；插件属于 profile，而不属于某个 dsh 检出目录。

```sh
dsh plugin --profile web add github:moonlight2893267956/dsh-usage-stats#path:packages/usage-stats
dsh plugin --profile web add /absolute/path/to/dsh-usage-stats/packages/usage-stats
```

末尾的 `#path:` 用来选中本仓库内的那个包 —— 仓库根是 workspace，不是插件本身。从 git 安装会通过 `prepare` 脚本自行构建，而 pnpm 会拦截该脚本直到你放行：先跑一次命令，把它打印的完整键填进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，再跑一次。之后重启 dsh，「用量」页出现在设置里。

## 目录

- [安装](#install)
- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本插件挂在它所读取的会话持久化旁边；它注册的只读路由随后为 Web GUI 的「用量」页提供服务。

### 最小配置

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

想要检查点使用 SQLite 介质的部署，再加上下面两行；不加时 `usage_stats` 域沿用该组合的默认后端，也就是共享的 `json`。

```yaml
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

`refreshPollIntervalMs` 控制核对期间的浏览器轮询间隔（默认 1000 ms，整数范围 250～10000 ms）。它注入 `sessionPersistence` 与 `storageDomain`：没有 `sessionPersistence` 时 fiber 一直 pending，没有 `storageDomain` 则激活时响亮失败。随包发布的 web 组合让 `usage_stats` 沿用 `json` 默认值，因为 `storage-sqlite` 在激活时就会打开数据库，而该组合同时会打包纯浏览器 Worker 部署，其 `node:sqlite` 桩会拒绝该构造函数；把该域路由到 SQLite 属于后续 patch 层的选择。

### 各字段含义

| 字段 | 含义 |
|---|---|
| `input` | 完整提示输入：未命中输入加缓存命中，因此已包含 `cacheRead` |
| `cacheRead` | 提示缓存命中——被复用的前缀 |
| `output` | 输出（补全）token |
| `requests` | 携带用量的助手消息数，每次模型补全请求计一条 |
| `searches` | 当天发起的 `web_search` 工具调用次数 |

单日请求还会带 24 个按小时的桶；尾部窗口只带按天的桶。窗口长度被钳制到 `[1, 370]`，不可用值默认为 30。

### 折叠语义

折叠读取持久化日志，而不是模型可见的接口面，因此后来被压缩对模型隐藏的 token 仍然计数，因为它们确实被消耗了。进程中的首次查询会对账持久化会话目录；后续查询只检查跨过持久化检查点的会话，因此重新打开「用量」页不会遍历全部已存会话。每个生命周期的文件 revision 仍会跳过日志字节未推进的会话。

### 阅读图表

每根柱子是一个桶：单日视图里是小时，窗口视图里是日期。柱子按输入未命中、缓存命中、输出堆叠；没有用量的桶仍会在基线轨道上保留刻度，因此空白小时读作“确认是 0”，而不是“数据缺失”。鼠标悬停或用键盘聚焦某根柱子，会显示该桶的精确数字。开启 `prefers-reduced-motion` 时入场级联与悬停动效会被关闭。

### 缓存显示与新鲜度

用量页读取 `GET /dsh-usage-stats/snapshot`，使用与严格读取接口 `GET /dsh-usage-stats/stats` 相同的 `days`、`date`、`models` 查询字段。快照返回 `value`、`freshness`、`revision`、`error` 和 `refreshPollIntervalMs`。页面立即显示上次完整保存的聚合结果，并在 `freshness: pending` 时标注正在更新。没有检查点时，首次回填完成之前 `value: null`；未经核对的零值不表示历史为空。核对完成、失败或页面关闭后停止轮询。`retry=1` 显式重试失败的后台扫描。

核对共享一个任务，完整 totals 与游标原子保存成功后才一并发布。扫描或保存失败保留此前完整视图和进度；页面保留图表并提供重试。检查点 schema 仍为 version 1。缓存显示移除首屏对核对的等待，不减少完整后台工作量；旧世代 revision 仍可能触发昂贵的迁移校验。

### 失败与恢复

查询不会因为某个会话日志损坏而失败：折叠会告警、跳过该会话，并且只在内存里记录其 revision，因此新进程会重试它。检查点丢失或过期只会在下次冷读时多回放一段日志尾部，绝不会丢数据，因为日志始终是权威。已从设备删除的会话保留其贡献。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

`UsageStatsService` 维护一份内存聚合：按本地自然日索引的按天桶，每个桶带 24 个按小时的桶和一份按模型的映射，外加每个会话生命周期一个折叠游标和最近一次 revision。首次折叠遍历 `sessionPersistence.list()`；后续折叠只检查被 `session/flush` 标记为失效的会话。它跳过 revision 未变化的生命周期，为其余每个日志打开读句柄，跳过 fork 继承的前缀（`inheritedEventCount`）以免 fork 出的子会话重复计入其父会话，并折叠游标之后的每个事件。`foldEvent` 把 `assistant/message` 的用量加到天、小时和模型累加器上，并统计名为 `web_search` 的 `tool/call` 事件。并发查询共享一个由生命周期持有的任务；严格读取还会核对等待期间到达的 flush。缓存读取只观察上次完整提交的状态。某次折叠有变动之后，服务会把整个检查点作为一个全局值写回 `usage_stats` 存储域——累计总量加上逐会话进度，不可读的会话被排除，以便重启后重试。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-session-persistence](../session-persistence/README.zh.md) —— 折叠所消费的持久化日志存储，提供列表、revision 与读取。
- [dsh-storage-domain](../../storage/storage-domain/README.zh.md) —— 检查点域设施及其后端路由。
- [dsh-client-ui-usage](../../client/ui-usage/README.zh.md) —— 渲染这些数字的「用量」设置页。

-----

<a id="model-experience"></a>
## 模型体验

无。该插件只是把已记录的会话事件计算成面向客户端的读模型，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；该插件从不组装或发送服务商请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了这些数字覆盖的范围以及检查点能恢复什么。它们是当前的包约束。

- **单个全局检查点记录** —— 检查点是单个全局值，承载累计总量与逐会话折叠进度，因此一次有变动的折叠会重写全部内容。schema 变更会提升域 `version`：`json` 后端会把陈旧记录备份下来，而把该域路由到 SQLite 的部署会在打开时遇到硬性的 `version-mismatch`。总量完全可从日志重导出，因此恢复方式是清空该单元而非迁移它。
- **重启后对损坏日志的重试** —— 只有可读会话会进入检查点，因此每个新进程都会重试损坏日志并再次告警；在单个进程内它只告警一次并被跳过。
- **没有按用途细分** —— 桶按 token 类型和按模型细分，但不按调用用途（对话、压缩、会话标题），因为持久化的 `assistant/message` 记录不携带请求的 `purpose` 字段；要进一步细分需要先把该字段记入日志。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。该包只聚合 `assistant/message` 用量记录与 `tool/call` 名称，它们的形状与追加顺序由 dsh-session 和 dsh-agent-loop 拥有并在运行时检查，并且通过 dsh-session-persistence 读取，其连续性与持久性也在那里检查；它自身不拥有可断言的事件关系。
