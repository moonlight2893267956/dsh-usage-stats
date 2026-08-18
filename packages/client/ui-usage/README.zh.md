# @deepseek-ai/dsh-client-ui-usage

[English](README.md) | 中文

设置里的「用量」页：一个由 `usageStats` Host Remote 支撑的按天 token 用量仪表盘。它把所选窗口内各类 token 的总量渲染成指标卡，把按天分布渲染成堆叠柱状图，并带悬浮提示；动画包括交错的柱子生长、卡片淡入和提示框淡入。

## 渲染内容

一个 `settings.section` 条目（`id: 'usage'`，order 30），即用量页：

- 顶部一行汇总（窗口内总 token 数与网络搜索次数）和 7天 / 30天 / 90天 区间切换。
- 每个 token 类别（输入、缓存命中、输出）一张指标卡，展示窗口总量。
- 按天分布的堆叠柱状图，带 Y 轴网格线、X 轴日期和图例；悬浮到某一天会弹出该天的精确数值。靠边缘的日期会让悬浮框向内对齐，避免被面板裁剪。

页面 store（`UsageStatsStore`）在挂载和每次切换区间时，通过 `ctx.remote.usageStats.stats()` 加载窗口数据，失败时保留上一次的好数据；聚合由 Host 负责。

## 组合

通过包的 `dsh.client` 声明和 `cordis.patch.yml` 里的一行（`ui-usage`）注册。需要 Host 包 `usage-stats` 提供 `usageStats` Remote 命名空间。

## 模型体验

无。该插件只是在设置页里渲染 Host 提供的用量数据，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；该插件从不组装或发送服务商请求。

## 已知限制与后续工作

- **打开时不实时刷新** —— 页面在挂载和切换区间时加载；页面停着不动期间产生的新用量要等下次重新加载才显示，不会持续更新。加推送失效或轮询能解决，但会引入这个静态页面并不需要的订阅。
