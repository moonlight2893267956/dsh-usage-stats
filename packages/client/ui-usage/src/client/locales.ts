/** `usage` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '用量',
  'title': '用量',
  'intro': '本设备上所有会话的 token 用量，按天聚合。用量按服务商费率另行计费，此处不展示费用。',
  'range.1': '今天',
  'range.7': '7天',
  'range.30': '30天',
  'range.90': '90天',
  'cat.input': '输入',
  'cat.cacheRead': '缓存命中',
  'cat.output': '输出',
  'requests': '请求',
  'unit.tokens': 'tokens',
  'card.input.sub': '命中率 {rate}%',
  'summary': '近 {days} 天共 {total} tokens · {requests} 次请求 · {searches} 次网络搜索',
  'chart.title': '每日 Tokens',
  'chart.title.today': '今日 Tokens',
  'chart.hint': '柱高为总量；输入段内已含缓存命中（绿色），命中不另行叠加，近 {days} 天',
  'legend.input': '输入（未命中）',
  'legend.cacheRead': '缓存命中',
  'legend.output': '输出',
  'tip.input': '输入（未命中）',
  'tip.input.cached': '输入（命中缓存）',
  'tip.total': '总计',
  'tip.searches': '网络搜索',
  'state.loading': '加载中…',
  'state.error': '用量加载失败',
  'state.retry': '重试',
  'state.empty': '这段时间还没有 token 用量',
  'model.title': '模型',
  'model.all': '全部模型',
} satisfies Record<string, string>

/** The usage namespace key union. */
export type UsageKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Usage settings section copy. */
    usage: UsageKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'nav': 'Usage',
  'title': 'Usage',
  'intro': 'Token usage on this device across every session, aggregated by day. Costs are billed separately at your provider rates and are not shown here.',
  'range.1': 'Today',
  'range.7': '7d',
  'range.30': '30d',
  'range.90': '90d',
  'cat.input': 'Input',
  'cat.cacheRead': 'Cache hit',
  'cat.output': 'Output',
  'requests': 'Requests',
  'unit.tokens': 'tokens',
  'card.input.sub': 'Hit rate {rate}%',
  'summary': '{total} tokens · {requests} requests · {searches} web searches in the last {days} days',
  'chart.title': 'Tokens per day',
  'chart.title.today': 'Tokens today',
  'chart.hint': 'Bar height is the total; the input slice already contains cache hits (green) and is not stacked on top, last {days} days',
  'legend.input': 'Input (miss)',
  'legend.cacheRead': 'Cache hit',
  'legend.output': 'Output',
  'tip.input': 'Input (miss)',
  'tip.input.cached': 'Input (cached)',
  'tip.total': 'Total',
  'tip.searches': 'Web searches',
  'state.loading': 'Loading…',
  'state.error': 'Could not load usage',
  'state.retry': 'Retry',
  'state.empty': 'No token usage in this window yet',
  'model.title': 'Model',
  'model.all': 'All models',
} satisfies Record<UsageKey, string>
