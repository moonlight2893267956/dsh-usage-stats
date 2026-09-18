# dsh-usage-stats — Token 用量统计插件（source of record）

跨会话的按天 token 用量统计，做在 DeepSeek Harness 的「设置 → 用量」页里：Host 端从持久化会话日志折叠出每日 token 用量，经 Typert Remote 暴露；Client 端渲染指标卡 + 每日堆叠柱状图 + 下拉日历选日期。

> **仓库定位**：这是该插件的**源码归档（source of record）仓库**。它由 deepseek-harness monorepo 内两个 `@deepseek-ai/*` 工作区包组成，**不在此仓库独立构建/独立发布**。要在实际环境里运行，把它拷进 `deepseek-harness` 仓库并应用 `wiring.patch` 即可（见下）。

> **版本基线**：本仓库对应 **DeepSeek Harness `dsh-0.1.6-alpha.2`**（`upstream/master` @ `ddefc45fbc`），两个包的 `version` 与该 harness 的 workspace 版本一致。上游每次发版都会动 client 架构与仓库门禁，迁移到别的版本前请先读「适配历史」一节。

## 适配历史

每一次上游 alpha 都要求本插件跟着改，逐版记录如下（最新在上）：

- **v0.1.6-alpha.2**
  - 上游 882 个提交，**插件源码零改动**：alpha.1 那轮门禁适配在 alpha.2 依然全绿（lint 0 error / `doc-sync` 41/41 / `hygiene` 16/16 / `typecheck` / 插件测试 46/46 / `test:gui` 6203 通过）。两个包只把 `version` 提到 `0.1.6-alpha.2`。
  - 上游新增 `docs/module-graph.{md,zh.md,i18n.yaml}`（模块图门禁），新包必须出现在其中 → `wiring.patch` 从 23 个文件增至 **26 个**。
  - 接线冲突点：上游在同一批文件里新增了 plugin-manager / office-to-pdf 的接线 —— `packages/api/remotes` 的 `pluginManagerRemote` / `officeToPdfRemote` 导入与 `$mount` 列表、`packages/bundle/web-app/cordis.patch.yml` 的 `ui-plugin-manager` 行。需与本插件接线**两侧都保留**，不是二选一。
  - `packages/client/tsdown.client.ts`：上游重写为按来源文件名切 chunk（`clientConfig` 多一个 `clientBanner` 参数、入口 banner 改为按 chunk 生成的函数、`chunkFileNames: 'client.[name].js'`）。本插件的 `REPOSITORY_ROOT` 查找补丁重放在新实现之上；插件没有动态 `import()`，因此不产生额外 chunk，`files` 列表无需跟着改。
  - 上游放松了 Agent Note 规则（`docs/AGENTS.md`）：机械／局部改动（含局部 UI 改动）不再强制要求 note。
- **v0.1.6-alpha.1**
  - 删除两个包的 `src/invariant.ts`：新门禁拒绝「空 `install` 函数」的伴生入口，改为在各自 README 写明「不发布伴生入口」的理由。
  - 依赖分区按新规则重排：浏览器/类型/客户端装配边（含 `api-remotes` 里生成的 `usage-stats/remote` 值导入）一律进 `devDependencies`；client 包只保留 `@deepseek-ai/cordis` 作为 peer。
  - 最后两处硬编码文案入字典：`model.count`（`{count} 个模型`）、`chart.dayLabel`（`{month}月{day}日`），否则 `verify-client-ui-i18n` 报错。
  - `AssistantProviderMetadata.model` 变为必填 → 删掉 `model !== undefined` 死分支；`JSX.Element` → `ReactNode`；`() => void` 箭头补花括号。
  - 两个包 README 重写为 `package-reference` 标准骨架（frontmatter / Summary / 目录 / 折叠实现 / Further Exploration / Model Experience / Known Limitations / Dev Note），中英逐行对齐并重录 `.i18n.yaml`。
  - manifest 的 `repository` 指向 harness 仓库 + `directory`（workspace 发布成员约束）。
  - `scripts/gen-doc-graphs.ts` 需要给 `ctx.usageStats` 加服务角色分类，否则 `verify-doc-graphs` 直接抛错。
  - 上游删除了 `knip.json`，旧的 wiring 第一段 hunk 作废。
- **v0.1.5**
  - `SessionHandle.read()` 返回 `{ eventState, events }` 而不是裸数组 → 测试桩与 `src/index.ts` 同步。
  - UI 主题门禁：中性边框必须写 `0.5px solid`（发丝线），填充分隔线高度改 `0.5px`，full-round 圆角必须配 `corner-shape: round`。
- **v0.1.3**
  - `assistant/message` 事件 data 必须带 `stream: AssistantStreamRecord[]` → 测试构造补 `stream: []`。
- **v0.1.2-alpha.1**
  - client 侧统一到 **store-in-register + `InjectFace`/`hooks.snapshot`**，禁止 runtime-import 其它 feature plugin 的值、禁止用 `dsh.client.external` 当依赖机制。
  - `ClientContext` 源头改 `@deepseek-ai/cordis`；`SnapshotStore`/`createSnapshotStore` 改 `@deepseek-ai/dsh-client-store`；测试的 `bindSnapshotSelector` 改自 `@deepseek-ai/dsh-client-test-runtime`。
  - Host 侧 `CallId` → `ToolCallId`（`@deepseek-ai/dsh-llm`）。
  - **构建前提**：client 的 tsdown bundle 必须在 **Node `^22.19 || >=24`** 上构建，且依赖 `wiring.patch` 里 `packages/client/tsdown.client.ts` 的 `REPOSITORY_ROOT` 查找修复；否则 bundle 会按 `import.meta.url` 算错仓库根。

## 目录结构

```
packages/session/usage-stats/   Host 包：@deepseek-ai/dsh-usage-stats（version 0.1.6-alpha.2）
  ├─ src/index.ts                UsageStatsService（TypertRemoteService，@Remote('stats')）
  ├─ src/spec.ts                 usage_stats 检查点域（zod + defineDomain）
  ├─ src/types.ts                请求/响应/每日/每小时桶类型
  ├─ tests/                      聚合 / 增量 / 回填 / 窗口钳制 / fork 去重 / Loader 组合
  └─ README.md / README.zh.md
packages/client/ui-usage/       Client 包：@deepseek-ai/dsh-client-ui-usage（version 0.1.6-alpha.2）
  ├─ src/client/UsageSection.tsx 「设置 → 用量」页（指标卡 + 堆叠柱状图 + 悬浮提示 + 动画）
  ├─ src/client/DatePicker.tsx   下拉日历（单日视图选任意过去一天）
  ├─ src/client/ModelFilter.tsx  模型多选筛选
  ├─ src/client/store.ts         UsageStatsStore（进入即重拉、切窗口重拉、generation 防过期覆盖）
  ├─ src/client/locales.ts       zh/en 字典（key-set 以 zh 为准）
  ├─ tests/                      组件 + store + DatePicker 测试
  └─ README.md / README.zh.md
.agents/notes/                 插件相关的 Agent Note（中英 + i18n 记录）
wiring.patch                   应用进 monorepo 的接线改动（26 个文件，见下）
```

## 设计要点

- **数据源是持久化会话日志**（每条 `assistant/message` 带 `usage` 与 `time`），Host 按天聚合并通过 Typert Remote `usageStats.stats()` 暴露给浏览器。日志本身即持久存储，因此**重启不丢、近 N 天历史可回填**。
- **增量折叠**：`sessionPersistence.list()` 列出会话及其 `revision`，revision 未变则整段跳过；否则 `open(id, 'read')` 后 `read(foldFrom)` 只读游标之后的事件，按 `event.time` 归入当天桶。`foldFrom = max(cursor, reader.inheritedEventCount)`，因此在 fork 出的子会话里**不会重复计入父会话已折叠的 token**。
- **检查点**：聚合结果与逐会话折叠进度写入 `usage_stats` 存储域（web 组合把它路由到 SQLite 后端）。冷启动回填一次，热启动只折叠增量；检查点是派生物，丢了只是多回放一段日志。无法读取的会话日志会告警 + 跳过，且**只记为内存 revision**，下次重启重试。
- **统计口径**：输入 = `inputTokens + cacheReadTokens`（输入已含命中，合计 = 输入 + 输出，避免与缓存命中重复计），缓存命中 = `cacheReadTokens`，输出 = `outputTokens`；`web_search` 工具调用计搜索数。单天窗口（`days=1` 或指定 `date`）额外返回 24 条逐小时明细。
- **Client 刷新**：`UsageSection` 每次挂载都重拉（不只在 `idle` 时），所以离开再进入「用量」页会显示最新数据。
- **窗口选项**：`[1, 7, 30]` 天；「今天」按小时渲染（只画到当前小时），多日按天渲染；日期选择器可打开任意过去一天并展示完整 24 小时。

## 如何装进 deepseek-harness 跑起来

1. 把 `packages/session/usage-stats` 拷到 `deepseek-harness/packages/session/usage-stats`。
2. 把 `packages/client/ui-usage` 拷到 `deepseek-harness/packages/client/ui-usage`。
3. 把 `.agents/notes/` 下的 note 按同名路径拷进 harness（可选，只为文档门禁）。
4. 在 harness 仓库根应用接线：`git apply wiring.patch`。
5. `pnpm install` && `pnpm run build`（会生成 `dsh-usage-stats/remote` 的 `typert.remote-client`）。
6. **重启 `dsh web`** 使其读取新的 `cordis.patch.yml` 组合，然后打开 **⚙ 设置 → 用量**。

`wiring.patch` 覆盖的 26 个文件分四类：

- **装配与接线**：`packages/api/remotes/{package.json,src/client/index.ts}`（`usageStatsRemote` 的 import / export type / `$mount`）、`packages/bundle/web-app/{cordis.patch.yml,package.json}`（host `usage-stats` 行、client `ui-usage` 行、`storage-sqlite` 行、把 `storage-domain` 的 `usage_stats` 域路由到 `sqlite`）。
- **编译面**：`tsconfig.base.json`（新增两个 path alias）、`tsconfig.client.json`、`tsconfig.host.json`、`packages/client/tsdown.client.ts`。
- **生成器与门禁**：`scripts/gen-cordis-catalog.ts`、`scripts/gen-doc-graphs.ts`、`scripts/verify-package-readme-model-experience.ts`、`packages/client/ui-settings-general/tests/shell.client.spec.ts`（settings 导航 section 列表多出 `usage`）。
- **生成物**（随附以便一次 apply 到位）：`docs/config-catalog.{md,zh.md,i18n.yaml}`、`docs/capability-seams.{md,zh.md,i18n.yaml}`、`docs/module-graph.{md,zh.md,i18n.yaml}`、`docs/subsystems/session.{md,zh.md,i18n.yaml}`、`packages/extensions/tool-cordis/src/api-catalog.ts`、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`。

> 生成物若因目标 harness 版本不同而 hunk 冲突，可只跳过这几段，然后重跑生成器补齐：
> `pnpm run gen-cordis-catalog && pnpm run gen-client-catalog && pnpm run gen-config-catalog && pnpm run gen-doc-graphs && pnpm run gen-module-graph`，
> 中文侧再用 `pnpm run verify-translation-pairing --write <md>` 重录配对记录。

## 验证 / 测试

- Host：`pnpm vitest run packages/session/usage-stats`
- Client：`pnpm vitest run packages/client/ui-usage`
- 全量 GUI 内环：`pnpm run test:gui`；文档门禁：`pnpm run doc-sync`

> `lib/`、`node_modules/` 等构建产物不入库（见 `.gitignore`），拷贝后用上面步骤构建。
