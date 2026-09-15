# Agent Note: 用量统计跳过不可读日志

Status: implemented

[English](2026-08-28-usage-stats-skips-unreadable-logs.md) | 中文

## Problem

Web 用量页通过 `SessionPersistence.readFrom` 扫描每个已物化 Session 日志，折叠 token 与搜索总量。只要一个历史 JSONL 工件的已提交日志损坏，例如已存前缀中出现 seq gap，这个 Remote 就会在任何聚合返回客户端前拒绝。持久化后端对该工件大声失败是正确的，但用量视图是覆盖多个独立 Session 的尽力读模型；一个不可读历史项不应隐藏其它所有用量。

## Decision

`UsageStatsService.foldAll` 按 Session snapshot 捕获 `readFrom` 失败。它记录一条 warning，点明被跳过的 Session id，保留已经折叠的总量，然后继续折叠剩余可读 snapshot。被跳过 snapshot 的 revision 会记录为已观察，因此用量页反复刷新时不会对同一份不可读字节反复解析和告警。若该工件之后被修复或追加，基于 stat 的 revision 会变化，服务会重新尝试读取。

持久化服务约定不变：`readFrom` 仍会拒绝损坏的已提交前缀。容错属于这个聚合 Consumer，因为它输出的是跨 Session 摘要，而不是需要精确目标日志的 resume、inspect、feedback 或 recovery 路径。

## Testing

`packages/session/usage-stats/tests/usage-stats.spec.ts` stub 出一个 `readFrom` 会以实测 seq-gap 错误拒绝的 snapshot，以及另一个包含 usage 与 search 事件的可读 snapshot。测试要求返回可读总量、发出一条 warning，并在下一次查询时跳过 revision 未变化的损坏日志。

## Alternatives considered

**在用量折叠中修复或截断损坏 JSONL。** 不采用，因为用量统计不是持久化恢复的拥有者，不能决定已提交记录是否可以丢弃。现有持久化修复仍只限于 torn tail 与平衡日志恢复。

**让 Remote 继续失败。** 不采用，因为这会把一个无关历史工件变成用量页整体不可用，即使请求的聚合对所有可读 Session 仍可部分正确。

**只推进 cursor 而不记录失败 revision。** 不采用，因为服务并未从该 snapshot 折叠任何事件；每次刷新重试同一份不可读字节只会重复工作并制造日志噪声。

## Consequences

当历史存储里存在不可读 Session 时，用量总数变为尽力结果。被跳过 Session 的 token 与搜索会缺失，直到该工件变化成可读 revision；健康 Session 继续正常报告。运维仍会获得包含 Session id 的服务端 warning，用于检查或修复损坏工件。
