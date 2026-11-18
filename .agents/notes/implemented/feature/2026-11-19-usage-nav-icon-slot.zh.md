# Agent Note：用量设置导航图标改用插槽

Status: implemented

[English](2026-11-19-usage-nav-icon-slot.md) | 中文

## 问题

用量设置分区（`id: 'usage'`，标签 `用量`/`Usage`）在设置弹窗的导航栏里显示通用设置齿轮，而插件的变通做法在它旁边又画了一个标记。外壳为每个 `settings.section` 条目渲染一个 `<button>`，内容为 `<span class="navIcon">` + `<span class="navLabel">`；插件按可见文本认领该行，并用 CSS `mask-image` 隐藏 `[data-dsh-usage-nav-icon] > svg`。

外壳接管导航字形后，这个认领失效了。DSH 0.2.2 的 `SettingsRoot` 把齿轮渲染在包装 span 里：

```jsx
<span className={css.navIcon} aria-hidden="true">
  {renderSlot('settings.section.icon', { size: 16, active }, { only: row.id, fallback: navIcon(row.id) })}
</span>
```

齿轮不再是行按钮的直接子元素，因此 `[marker] > svg { display: none }` 匹配不到任何东西。结果该行同时显示外壳的齿轮与插件绘制的标记——一行两个图标。

## 决策

在外壳现已声明的 `settings.section.icon` 插槽上注册标记：

```ts
ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
  name: 'settings.section.icon',
  id: 'usage',
  locale: NS,
}, UsageNavIcon))
```

该插槽正是前一份笔记写明的删除条件：“`settings.section` 长出 `icon` 字段的那天即可删除”。它是 root 作用域的列表：注册 id 必须等于目标分区 id，id 不匹配的注册永不渲染，外壳通过 `renderSlot(..., { only: row.id, fallback: navIcon(row.id) })` 读取它。未注册图标的分区保留外壳默认字形，因此对其他每一行都是纯增量。

`UsageNavIcon` 接收 `{ size, active }`，以 `currentColor` 绘制 L 形坐标轴与三根递增柱，笔画权重与外壳的 1.3 一致，形态与页面的按日堆叠图呼应。几何表、轴路径与基线从被删除的 `nav-icon.ts` 原样迁移；CSS 遮罩、`MutationObserver` 与按文本匹配全部移除，因为外壳现在按分区 id 寻址图标，不再需要插件猜测是哪一行。

未声明该插槽的早期外壳继续显示齿轮：`ctx.slots.inject` 会等待声明，注册在那里不会落地。

## 备选方案

**保留 DOM 认领并修复选择器。** 改成隐藏包装层里的 `svg`（`[marker] .navIcon > svg`）仍会让插件自己持有样式表、观察器和文本匹配，去复现一个外壳已经自己做出的判断——并且每次外壳改标记结构都会再次失效。故直接删除。

**修改外壳的 `navIcon` 映射。** 第一份笔记走的路；树外插件无法实施，在打包版本里同样不可达。

**用行上的 `::before` 绘制标记。** 同一类缺陷：从外部给别人的行贴样式。

## 后果

- 用量行只有一个标记——外壳自身的字形被替换，而不是叠加。
- 标记通过 `currentColor` 跟随行的主题与选中态，并采用外壳通过 `size` 传入的边宽。
- 插件不再观察 DOM、不注入样式表、不匹配本地化文本：语言切换无需重新推导，卸载不会遗留标记。
- 图标依赖宿主声明 `settings.section.icon`。在未声明的宿主上（0.2.1 及更早），该行保留齿轮——只是外观退化，不会弄坏弹窗。
- `packages/usage-stats/package.json` 的开发依赖现固定为 `~0.2.2-rc.3`：这是第一个其 `@deepseek-ai/dsh-client-ui-settings` 声明该插槽并导出 `SettingsSectionIconOwnerProps` 的已发布线；原先的 `~0.2.1-alpha.1` 无法让该注册通过类型检查。

## 测试

`tests/nav-icon.client.spec.tsx`（jsdom，5 项）渲染组件：轴路径与每根柱都来自几何表；柱落在基线上且递增；`size` 驱动渲染边宽而 16 单位 `viewBox` 不变；默认采用导航方框；svg 保持 `aria-hidden`，因为标签由行本身承载。被删除的 `nav-icon.client.spec.ts` 覆盖的是本次移除的认领机制。

本次改动下包内测试 76/77 通过。`tests/loader-composition.spec.ts` 在 stash 后的改动前代码树上同样失败——它期望 `@deepseek-ai/dsh-session-persistence-jsonl` 在其组合中加载——因此该失败先于本次改动且与之无关。

`pnpm --filter @moonlight2893267956/dsh-usage-stats run build`（host、bundle、client）通过，且已安装的 bundle 带有该注册：实时图 rev 对应的 `client.js` 含 `settings.section.icon`，且无 `data-dsh-usage-nav-icon` 残留。
