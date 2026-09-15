# Agent Note: usage-stats SQLite checkpoint

Status: implemented

[English](2026-09-07-usage-stats-sqlite-checkpoint.md) | 中文

## Problem

`@deepseek-ai/dsh-usage-stats` 从持久化会话日志把跨会话的按天 token 用量折叠进进程内累加器。折叠在单个进程内是增量的，但累加器没有持久化：重启后的第一次 `stats` 调用会通过完整扫描每一条持久化日志来回填，而每个新进程、重复访问或新进程里的页面刷新都会重新付出这次全量扫描。在日志多且大的设备上，这是随用量历史增长、而非随上次查询以来发生多少变化增长的反复冷回填成本。

## Decision

把折叠结果持久化到 `usage_stats` 存储域检查点，并通过 SQLite 后端路由。进程内的 `Map` 仍是单进程内的热路径；存储域服务于重启与重复访问。

- **单个全局记录，无表。** 检查点是单个全局值，承载累计的按天/按小时/按模型总量，以及逐会话折叠进度表（`<id>:<createdAt>` → `{ cursor, revision }`）。单独的 `global.set` 是一次原子后端写；把总量与逐会话进度拆到多行，会使崩溃可能把一个领先于其总量的游标持久化下来（永久欠计），或落在其后方（重复计数），因此故意不用 per-record 布局。
- **在 `Service.init` 打开并播种。** 服务注入 `storageDomain`；init 打开域名、注册关闭 effect、从持久化全局值播种内存累加器（冷启动时为空），并在下一次 `stats` 只折叠增量。
- **在有变动的折叠后回写。** 折叠后，只要任一会话有推进，就原子重写检查点。持久化的逐会话进度只记录成功折叠的会话；无法读取的日志绝不记录，因此损坏会话会在下次重启时被重试（并再次告警）——在单个进程内它只告警一次并被跳过，与原先一致。
- **通过 `storage-domain` 路由，而非 `session-query-sqlite`。** 后者服务于全文搜索，不是用量聚合。web 组合挂载 `storage-sqlite`，并把 `usage_stats` 路由到 `sqlite` 后端；该行放在 web profile 而非 base，因为 SQLite 后端在激活时急切打开数据库。无任何 API 或 UI 契约变更。

## Alternatives considered

- **用 `session-query-sqlite` 作为检查点介质。** 否决：它拥有的是搜索索引与内存查询面，而非衍生聚合的检查点；复用它会把用量统计与搜索内部耦合起来，还牵涉其 `openAt`/`path` 生命周期。
- **per-record 布局，每会话一行。** 否决：它失去单次原子写。在会话行游标写入与总量写入之间崩溃，会让折叠进度与总量不一致，又没有跨记录事务去调和——检查点是衍生数据，绝不能持久化一个永不自我修复的错误但陈旧的值。
- **只持久化逐会话游标、重算总量。** 否决：重建总量仍要扫描每一条变化日志，因此并未消除检查点本要避免的冷回填成本。
- **维持现状（仅内存）。** 否决：重启与重复访问持续付出全量扫描。

## Consequences

- web profile 现在挂载 `storage-sqlite`（路径 `dshHomePath('storages/usage-stats.db')`），并重述 `storage-domain` 的配置，把 `usage_stats` 路由到 `sqlite`，同时让 base 的 `json` 默认值继续服务于每个其他域名。
- `usage_stats` 域名以一个单元做版本戳。SQLite 后端没有逐记录版本范围，也没有 `backupRecord`；因此 `invalidRecords: 'backup-and-skip'` 在那里会退化为 fail-loud。检查点 schema 变更会提升域名 `version`，SQLite 在打开时把它当作硬性的 `version-mismatch` 拒绝——恢复方式是清空单元，而非迁移，因为该数据完全可从日志重导出。
- 损坏日志会在每个新进程被重试（它从不推进检查点），因此一个存在永久损坏日志的环境会在每个进程里重新告警一次，而不是只告警一次。
- 包注入 `storageDomain`；没有存储栈却挂载 `usage-stats` 的组合会在激活时响亮失败。
