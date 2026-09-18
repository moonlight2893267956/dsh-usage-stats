# Agent Note: usage-stats checkpoint rides the profile's storage backend

Status: implemented

[English](2026-09-18-usage-stats-checkpoint-backend.md) | 中文

## Problem

[前一篇 note](2026-09-07-usage-stats-sqlite-checkpoint.zh.md) 把 `usage_stats` 折叠结果持久化为 `storage-domain` 检查点，并在随包发布的 web 组合里把该域路由到 `storage-sqlite`。`storage-sqlite` 在构造函数里就打开数据库，而 web profile 同时也是纯浏览器 Worker 部署所组合的那个 profile：`apps/web/tests/preview-boot.e2e.ts` 把 web profile 打包成 VFS 镜像、启动它，并断言控制台干净。该宿主把 `node:sqlite` 打桩为失败，于是打包链路报出 `web-preview: node:sqlite.DatabaseSync is not available in the worker host` 与 `dsh-webworker: warning: 1 entry did not activate / usage-stats`。web profile 中另一个 SQLite 条目 `session-query-sqlite` 正是为此配置成 `openAt: never`，因此这个急切打开的后端条目是唯一无法在那里启动的条目。

## Decision

随包发布的 web 组合让 `usage-stats` 沿用 base 的存储默认值。`usage_stats` 检查点与其它每一个域一样走 `json` 后端，该组合既不加 `storage-sqlite` 条目，也不加 `storage-domain` 的 `routes` 覆盖。想要 SQLite 介质的部署在自己的后续 patch 层里同时加上这两者。检查点设计其余部分不变：单个全局记录、在 `Service.init` 播种、在有变动的折叠后回写。

## Alternatives considered

- **保留急切的 `storage-sqlite` 条目，在 Worker 宿主上禁用它。** 否决：loader 上下文暴露的任何东西都无法区分该宿主——Worker 的 `node:sqlite` 桩是在模块层面失败，而非通过可读的服务失败——而 `storage-domain` 仍会把 `usage_stats` 路由到同一宿主从不注册的后端，失败只会从后端条目转移到域名打开。
- **给 `storage-sqlite` 加一个惰性的 `openAt` 选项。** 否决：延迟打开属于 `session-query-sqlite` 搜索专有的生命周期；给存储后端加一个对应字段，是为了单个部署的收益去扩大它对外发布的 config。
- **放弃检查点，保留纯内存累加器。** 否决：这会让检查点本要避免的完整冷回填重新付出代价，而检查点正是让 web 页面重复访问变便宜的东西。

## Consequences

- `apps/web/tests/preview-boot.e2e.ts` 重新启动出一条干净链路：没有任何条目激活失败，Worker 宿主也永远不会触及 SQLite 构造函数。
- `usage_stats` 检查点改为经 `storage-json` 写入 `<dsh home>/storages`。因为布局是单个全局记录，每次有变动的折叠都会重写该单元的整份文档——总量加上逐会话折叠进度表——而 SQLite 只会触碰一行。该文档相对它所替代的日志扫描很小，因此写入量由折叠次数限定，而非由会话历史限定。
- 持久性不变：检查点仍能跨重启与重复访问存活，且仍是衍生数据，丢失只付出一次尾部回放。
- 把 `usage_stats` 路由到 `sqlite` 的部署，仍保留前一篇 note 记录的版本戳行为，包括打开时硬性的 `version-mismatch`、其恢复方式是清空单元。而 `json` 后端遵循 `invalidRecords: 'backup-and-skip'`，因此检查点自身的记录会被备份，而不是让打开失败。
