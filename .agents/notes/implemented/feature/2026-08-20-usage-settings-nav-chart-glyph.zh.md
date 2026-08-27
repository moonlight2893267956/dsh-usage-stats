# Agent Note: 用量设置导航图表字形

Status: implemented

[English](2026-08-20-usage-settings-nav-chart-glyph.md) | 中文

## 问题

用量设置分区（`id: 'usage'`，标签 `用量`/`Usage`）渲染一张按天聚合的 token 用量堆叠柱状图，但其在设置弹窗导航行中的图标是通用的设置齿轮。`ui-settings-general` 的 `SettingsRoot` 中 `navIcon` 映射仅为 `models`、`agent-presets`、`plugins` 命名了字形；其余所有分区 id——包括 `usage`——都落入 `IconSettingsOutline16`。用量是弹窗中视觉特征最强的分区，却使用了特征最弱的导航图标。

## 决策

在 `ui-primitives` 的 `ic_ds_*` 图标集中新增柱状图字形 `IconChartOutline16`，并扩展 `SettingsRoot.navIcon`，使其对 `id === 'usage'` 返回该字形。三根从基线升起的柱形读作逐期用量趋势，与该分区的按天堆叠图表一致。该字形为手工近似版本：deepsuite 图标库未提供图表导出，因此它以闪光、鱼形字形既有的方式替代，`ui-primitives` README 记录了这一先例。

导航图标映射仍由 `ui-settings-general` 的外壳拥有——分区注册方不声明自己的字形。映射以分区 id 为键，因此外壳未识别的贡献分区仍回退到齿轮；`usage` 现加入与 `models`、`agent-presets`、`plugins` 并列的已命名集合。

## 备选方案

**复用现有字形。** `IconDataOutline16`（数据库）已用于 `models`；第二个数据分区共用它会读作重复，且没有已发布的字形描绘趋势或柱形。

**让每个分区注册方携带自己的图标。** 这会为纯粹的外观选择扩展 `settings.section` 插槽契约，将字形所有权分散到各功能插件，而非集中在设置导航已拥有的单一外壳映射。

**等待 deepsuite 图表导出。** 用量导航将无限期保留错误的齿轮；近似版本沿用既有的鱼形/闪光路径，待精确导出就绪后替换。

## 后果

- 用量导航行现携带与所有其他已命名分区均不同的图表字形；settings-root 导航字形测试覆盖了 `usage` id 及另外三者，图标集计数测试变更为 71。
- e2e aria 基线不受影响：设置导航将每个图标仅捕获为 `img`，无区分字形的标记，因此更换路径无需刷新基线。

## 测试

`icons.client.spec.tsx` 的集合计数断言与逐字形的 `currentColor` 渲染覆盖了新字形；`settings-root.client.spec.tsx` 的导航字形区分性测试断言 `usage` 获得自己的路径，而未知 id 仍共用齿轮。仓库 `typecheck` 与 `lint` 通过。
