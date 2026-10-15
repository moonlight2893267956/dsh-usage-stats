# Agent Note: 用量设置导航字形认领

Status: implemented

[English](2026-10-15-usage-nav-glyph-claim.md) | 中文

## 问题

用量设置分区（`id: 'usage'`，标签 `用量`/`Usage`）在设置弹窗导航栏中显示的是通用设置齿轮。`@deepseek-ai/dsh-client-ui-settings-general` 的 `SettingsRoot.navIcon` 只为 `account`、`models`、`agent-presets`、`plugins`、`archived-sessions` 命名了字形，其余分区 id 一律落入 `IconSettingsOutlineMedium`。弹窗中页面视觉特征最强的分区，反而拥有最弱的导航图标。

早先的[导航图表字形笔记](2026-08-20-usage-settings-nav-chart-glyph.zh.md)通过修改 harness 解决了这一点：在 `ui-primitives` 新增 `IconChartOutline16`，并在外壳的 `navIcon` 中增加 `usage` 分支。该路径现已不可用。本仓库是树外插件，而那处改动位于上游从未合并的 harness fork 中，因此已发布的外壳仍回退到齿轮。`settings.section` 插槽契约没有 `icon` 字段——外壳只从注册项投射 `id` / `order` / `label`——插件无法传入外壳会采纳的字形。

## 决策

插件在弹窗挂载后认领自己的导航行，沿用 `dsh-market` 对同一问题的做法：注入一张样式表，在被打标记的行上隐藏外壳齿轮，并通过 `currentColor` 的 CSS `mask-image` 绘制标记；随后把可见文本等于本插件当前分区标签的那一行标记出来。

两条性质保证这次认领是诚实的：

- **归属按标签判定，绝不按位置。** 除 `[role="dialog"] nav button` 之外，不假设外壳 DOM 的任何结构——而这正是外壳自身契约中记录的形态。只有当某行文本等于本插件当前投射的标签时才会被标记，因此 `模型` 与另一插件的 `插件市场` 都保留自己的图标；而未解析（空）的标签不匹配任何行——尚未落地的语言环境不可能标记整个导航栏。
- **认领是导出的，而非一次性安装的。** 由 `MutationObserver` 重新推导，因此启动后再打开弹窗、分区稍后注册、以及语言切换导致导航栏重渲染，都无需重新注册分区即可生效。

标记与样式表同属一个 `ctx.effect`，因此会随 fiber 一并移除，而不会在卸载后残留。标记为 L 形坐标轴加三根递增柱形，采用外壳 1.3 的描边宽度，读作逐期用量趋势，并与该分区的按天堆叠图表相呼应；其几何数据只有一张表，遮罩与绘制出的标记都由它推导。

## 备选方案

**修改 harness。** 即前一篇笔记的路径。它要求每位用户运行打过补丁的 harness 构建，且无法触及本插件实际被安装进的打包应用。

**为 `settings.section` 增加 `icon` 字段。** 这是长期正确的席位，也是本模块被设计为可删除的原因：它属于 harness 拥有的 pre-stable 公共插槽契约，新增该字段是上游改动，单个插件无法自行发布。`dsh-market` 记录了同样的删除条件。

**按 id 复用外壳已有字形。** 不可行：该映射为外壳私有，且以本插件并不拥有的 id 为键。

**用注入的 React 组件绘制标记。** 导航栏各行由外壳依据自身账本渲染，注册方在其中没有渲染位点。认领该行是插件可达的唯一席位。

## 后果

- 用量行在两种主题与激活态下都携带与其他分区均不同的柱状图标记，且不触碰外壳或插槽契约。
- 若某个外壳更改了弹窗标记，或不再渲染 `[role="dialog"] nav button` 行，该行会静默退回齿轮。标记属于外观，因此失效表现为观感降级，而非弹窗损坏。
- 认领基于文本，因此若同一语言环境下两个分区投射完全相同的标签，两行都会被打上标记。已发布组合中各分区标签互不相同；待 `settings.section` 增加 `icon` 字段之日，本模块将被整体删除。
- 不涉及任何 harness 包、`ui-primitives` 导出或 e2e aria 基线改动：标记由插件自身的 bundle 承载。

## 测试

`tests/nav-icon.client.spec.ts`（jsdom，11 条）钉住那些安静而非响亮的失效：认领其他分区的行、标签未解析时仍然认领、语言切换后残留旧认领、弹窗打开后才挂载的行未被认领，以及销毁后残留标记或样式表、遮罩与绘制几何发生漂移。前四条均以变异验证：破坏相应守卫会让对应用例变红。几何用例还将各柱形约束在基线上并保持递增顺序。

`pnpm --filter @moonlight2893267956/dsh-usage-stats run build`、`tsc -b tsconfig.client.json` 与包内测试（72 条）均通过。
