# Agent Note: 用量统计计入两个缓存分区并展示搜索次数

Status: implemented

[English](2026-10-16-usage-stats-cache-write-and-search-count.md) | 中文

## 问题

同一条读取路径上存在两个缺陷。

**缓存写入从 `input` 中丢失。** 折叠把提示输入算作 `inputTokens + cacheReadTokens`，理由是加上 `cacheWriteTokens` 会重复计数。该理由不成立：`dsh-llm` 的 `TokenUsage` 声明这些计数互不重叠——`inputTokens` 只是**未命中**的提示，缓存输入另行以 `cacheReadTokens`/`cacheWriteTokens` 报告，因此计费输入是三者之和。于是任何会上报缓存创建的路由，其每条提示都被少计。`llm-pi-ai` 在 `cacheWriteTokens` 非零时就会发出它，`llm-deepseek` 则把 `cache_creation_input_tokens` 映射到该字段。

**搜索次数从未到达页面。** 名为 `web_search` 的 `tool/call` 事件被折进按天与按小时的 `searches` 总量，写进检查点，在 wire 类型上有字段，在客户端也做了累加——随后被丢弃：`UsageSection` 把它们求和到一个局部 `searches`，却没有渲染任何元素。而两份 README 都宣称页面会报告网络搜索，于是这个已文档化的功能实际不可见。

## 决策

**input 就是完整的提示侧。** `foldEvent` 现通过一个具名的 `promptInput` 辅助函数累计 `inputTokens + cacheReadTokens + cacheWriteTokens`，让该契约只存在于一处，四个累加器（天、小时、按模型的天、按模型的小时）无法彼此漂移。`cacheRead` 仍单独累计，因为命中率展示要拿它除以 `input`。

**不重折历史。** 折叠按逐会话游标推进，已折过的事件永不重读；因此改变累加方式时，检查点里已有的每一天都会继续沿用旧算式，除非清空该单元。清空会重折全量语料（本机冷折 19–28 秒），并且还会丢掉已从设备删除的会话的贡献——那是本包有意保留的行为。于是两种算式并存：本次改动之前折出的日期保留旧 `input`，之后折出的使用新算式。本机所有已记录的 `cacheWriteTokens` 均为 `0`，所以可见差异为零；这项修正对确实会上报缓存创建的路由才有意义。

**搜索次数作为副标，而非第五张卡片。** 请求卡片本就带有输入命中率的副标，而 `.cards` 网格是两列——第五张卡片会留下一个落单的尾格。该次数无条件渲染，包括 `0`，因此这一行读起来是一个实测值，而不是时有时无。

**不改 schema。** `foldEvent` 只写既有字段，因此检查点仍为域版本 1，不会有任何东西被作废。

## 备选方案

**提升域版本，让 schema 声明新语义。** 没有必要——没有字段变化——而且有害。两种后端都会在打开时以 `version-mismatch` 拒绝陈旧单元，且 JSON 后端保留文件而不备份，于是所有注入 `storageDomain` 的插件都会停在 pending，直到用户手动删除 `usage_stats.json`。README 此前声称 JSON 后端会备份陈旧记录；我用一个探针写入版本 1 的单元并以版本 2 重开，证伪了该说法，并已更正。

**就地清空检查点以重折全部内容。** 能修正历史，但会静默撤销已删除会话的贡献，并在用户下次打开时付出一次完整冷折。拒绝以一个 bug 修复之名施加这种静默代价；改为记入已知限制。

**把 `cacheWrite` 作为独立字段，好让页面拆分展示。** 图表的堆叠展示的是输入未命中、缓存命中、输出三段，三个提示分区并非它所画的内容；而多出这个字段会为一个 UI 并不区分的差异强推 schema 变更。

**为搜索次数增加第五张指标卡。** 会打破两列网格的平衡，并让 `web_search` 调用次数获得与 token 总量同等的视觉分量。

## 后果

- 对新折出的事件，`input` 现在是真正的提示侧总量，`input + output` 则是该请求的全部计费总量。命中率的分母随之变大，因此对会上报缓存写入的路由，报告的百分比会略微下降。
- 图表的输入未命中段（`input - cacheRead`）现包含缓存写入，这正是「未命中缓存的提示 token」的正确读法。`输入（未命中）` 文案依然准确。
- `cacheRead`、`output`、`requests`、`searches`、`models` 与按小时桶均不变。
- 页面会展示搜索次数；wire 值与路由查询串不变，因为 `searches` 本就已有类型并在传输中。
- 用户检查点中已有的日期保留修复前的 `input`。README 的已知限制记录了「折叠算式的变更只作用于新事件」。

## 测试

`tests/usage-stats.spec.ts` 在全部四个累加器上钉住该算式，而不只是天的总量——只修天桶的改动会让筛选视图与按小时视图同它对不上，该变异已确认会让用例失败。`tests/UsageSection.client.spec.tsx` 渲染一个 `searches: 2 + 3` 的窗口并断言 `5 次网络搜索` 副标，另有一条用例证明零次数依然渲染；移除该副标已确认会让两条都失败。

`tsc -b tsconfig.client.json tsconfig.node.json` 干净，包内测试 81 条全部通过。
