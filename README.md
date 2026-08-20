# dsh-usage-stats — Token 用量统计插件（source of record）

跨会话的按天 token 用量统计，做在 DeepSeek Harness 的「设置 → 用量」页里：Host 端从持久化会话日志折叠出每日 token 用量，经 Typert Remote 暴露；Client 端渲染指标卡 + 每日堆叠柱状图。

> **仓库定位**：这是该插件的**源码归档（source of record）仓库**。它由 deepseek-harness monorepo 内两个 `@deepseek-ai/*` 工作区包组成，**不在此仓库独立构建/独立发布**。要在实际环境里运行，把它拷进 `deepseek-harness` 仓库并应用接线改动即可（见下）。

## 目录结构

```
packages/session/usage-stats/   Host 包：@deepseek-ai/dsh-usage-stats
  ├─ src/index.ts                UsageStatsService（TypertRemoteService，@Remote('stats')）
  ├─ src/types.ts                请求/响应/每日桶类型
  ├─ src/invariant.ts            package invariant
  ├─ tests/                      聚合/缓存/忽略无关事件/增量/回填/窗口钳制 + Loader 组合测试
  └─ README.md / README.zh.md
packages/client/ui-usage/       Client 包：@deepseek-ai/dsh-client-ui-usage
  ├─ src/client/UsageSection.tsx 「设置 → 用量」页（指标卡 + 堆叠柱状图 + 悬浮提示 + 动画）
  ├─ src/client/store.ts         UsageStatsStore（进入即重拉、切窗口重拉、generation 防过期覆盖）
  ├─ src/client/locales.ts       zh/en 字典
  ├─ tests/                      组件 + store 测试
  └─ README.md / README.zh.md
wiring.patch                     应用进 monorepo 的 6 处接线改动（见下）
```

## 设计要点

- **数据源是持久化会话日志**（每条 `assistant/message` 带 `usage` 与 `time`），Host 按天聚合并通过 Typert Remote `usageStats.stats()` 暴露给浏览器。日志本身即持久存储，因此**重启不丢、近 N 天历史可回填**，无需另建存储。
- **增量折叠**：`sessionPersistence.list()` 列出会话，`readFrom(id, cursor)` 只读新增事件，按 `event.time` 归入当天桶；`assistant/message.usage` 累加 token，`web_search` 工具调用计搜索数。
- **统计口径**：输入 = `inputTokens + cacheReadTokens`（输入已含命中，合计 = 输入 + 输出，避免与缓存命中重复计），缓存命中 = `cacheReadTokens`，输出 = `outputTokens`。单天窗口（`days=1`）额外返回逐小时明细 `hours`（24 条），由 Client 的「今天」视图按小时渲染柱状图。
- **Client 刷新**：`UsageSection` 每次挂载都重拉（不只在 `idle` 时），所以离开再进入「用量」页会显示最新数据，而不是首次访问的旧合计。
- **窗口选项**：`[1, 7, 30]` 天（移除 90 天）。「今天」视图按 24 小时桶渲染，X 轴标签 `00:00`/`08:00`/`16:00`/`23:00`；多日视图按天渲染。
- **导航图标**：设置页 Usage 导航使用 `IconChartOutline16`（柱状图 glyph），区别于 Models 的数据图标。

## 如何装进 deepseek-harness 跑起来

这是 monorepo 内部包，需满足仓库约定（`pnpm-workspace.yaml` 提供了导出的默认 glob，所以只需正确接线）：

1. 把 `packages/session/usage-stats` 拷到 `deepseek-harness/packages/session/usage-stats`。
2. 把 `packages/client/ui-usage` 拷到 `deepseek-harness/packages/client/ui-usage`。
3. 应用 `wiring.patch`（`git apply wiring.patch`），或手动照做以下 6 处：
   - `packages/api/remotes/src/client/index.ts`：import / export type / `$mount` 数组各加 `usageStatsRemote`。
   - `packages/api/remotes/package.json`：dependencies 与 devDependencies 各加 `@deepseek-ai/dsh-usage-stats: workspace:^`。
   - `packages/bundle/web-app/cordis.patch.yml`：host 段加 `usage-stats` 行，client 段加 `ui-usage` 行。
   - `packages/bundle/web-app/package.json`：dependencies 加 `@deepseek-ai/dsh-client-ui-usage` 与 `@deepseek-ai/dsh-usage-stats`。
   - `tsconfig.host.json`：references 加 `./packages/session/usage-stats`。
   - `tsconfig.client.json`：references 加 `./packages/client/ui-usage`。
   - `knip.json`：`packages/session/usage-stats` 加 `ignoreDependencies: ["zod"]`。
4. `pnpm install`，`pnpm run build`，生成 Typert remote（`dsh-usage-stats/remote` 的 `typert.remote-client`）。
5. **重启 `dsh web`** 使其读取新的 `cordis.patch.yml` 组合，然后打开 **⚙ 设置 → 用量**。

## 验证 / 测试

- Host：`pnpm vitest run packages/session/usage-stats`（聚合、增量不重算、回填、窗口钳制、Loader 组合挂载测试）。
- Client：`pnpm vitest run packages/client/ui-usage`（store 加载/失败/切窗口/过期响应；组件渲染/空态/错误重试/切区间/进入再拉取）。
- 全量 GUI 内环：`pnpm run test:gui`。

> `lib/` 等构建产物不入库（见 `.gitignore`），克隆/拷贝后用上面步骤构建。
