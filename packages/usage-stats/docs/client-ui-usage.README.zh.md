---
description: "Web GUI 里的「用量」设置页：按天 token 总量、模型筛选，以及读取 usageStats Host Remote 的日期选择器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-usage

[English](README.md) | 中文

## 概述

用这个包，不离开 Web GUI 就能看到本设备花了多少 token。设置里的「用量」区段按今天、7 天或 30 天窗口汇总输入、缓存命中和输出 token，把按天或按小时的分布画成堆叠柱状图，并统计网络搜索次数。模型筛选把每个数字收窄到你选中的模型，日期选择器则打开某一天并展示其按小时细分。数据在挂载时和每次变更时从 Host 读取，因此页面报告的是持久化用量，而不是当前会话的计数器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本插件与设置外壳和 `usage-stats` Host 包一起挂载；「用量」区段随后出现在设置导航里。

### 页面展示什么

四张指标卡汇总所选窗口内的输入、缓存命中、输出和请求数。下方的图每天一根柱子，并拆分为输入、缓存命中、输出三段；「今天」视图改为每小时一根柱子并只画到当前小时，因此半天过去的一天读起来就是「到目前为止」。悬浮某根柱子会弹出该柱的精确数值，切换窗口时柱子、卡片和提示框都会淡入。

### 选择窗口、某一天与模型

「今天」「7天」「30天」按钮设定尾部窗口；「今天」是默认值，也是唯一按小时渲染柱子的预设。日期选择器可把任意过去的一天打开为单日窗口并展示完整的按小时细分，选中某一天会清除尾部窗口的选择。模型筛选把所有卡片和柱子收窄到选中的模型，并列出 Host 为该窗口报告的全部模型，因此可选项不会缩到只剩当前选中项。

### 失败与恢复

加载失败会保留上一次的好数据，并显示错误和「重试」按钮；窗口内没有任何用量时显示空状态文案，而不是一张空图。加载进行中时，页面用一行加载提示代替图表。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

页面 store `UsageStatsStore` 持有单个快照：状态、错误、窗口长度、可选的单日日期、返回的桶，以及模型选择。`apply` 创建它并通过 slot 的 `inject` face 下发，store 本身放在保留的 `hooks` 舱位里，由渲染器绑定为 `useSnapshot`；各个动作（`setDays`、`setDate`、`setModels`、`load`）走注入的 controller。每个动作先写快照再重新加载，每次加载都带一个 generation 计数，因此较慢的早先响应永远不会覆盖较新的响应。插件通过 `ctx.slots.inject` 注册一个 `settings.section` 条目（`id: 'usage'`，order 30），字典也注册在同一个 fiber 上，因此卸载会同时移除两者。Host 调用是 `ctx.remote.usageStats.stats()`，其结果是 `RemoteResult`：载体失败以 `ok: false` 返回，并作为页面错误呈现，而不是抛异常。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-usage-stats](../../session/usage-stats/README.zh.md) —— 本页读取的 Host 聚合，以及它的折叠规则和检查点。
- [ui-settings](../ui-settings/README.zh.md) —— 声明 `settings.section` slot 的设置外壳。
- [客户端包地图](../README.zh.md) —— 相邻的浏览器 UI 包及其共同规则。

-----

<a id="model-experience"></a>
## 模型体验

无。该插件只是在设置页里渲染 Host 提供的用量数据，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；该插件从不组装或发送服务商请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前的「用量」页面。它们是当前的包约束。

- **打开时不实时刷新** —— 页面只在挂载和切换区间时加载，因此页面停着不动期间新增的用量要等下次重新加载才出现；加推送失效或轮询能解决，代价是引入这个静态页面并不需要的订阅。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。该插件拥有一个设置区段注册、一个页面 store 和一份语言字典，三者都由注册它们的 fiber 的 effect 释放，因此运行时不存在第二个可校验的权威。
