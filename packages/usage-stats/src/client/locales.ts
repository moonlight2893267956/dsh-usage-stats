/** `usage` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '用量',
  'title': '用量',
  'range.1': '今天',
  'range.7': '7天',
  'range.30': '30天',
  'cat.input': '输入',
  'cat.cacheRead': '缓存命中',
  'cat.output': '输出',
  'requests': '请求',
  'card.input.sub': '命中率 {rate}%',
  'card.requests.sub': '{searches} 次网络搜索',
  'chart.title': '每日 Tokens',
  'chart.title.today': '今日 Tokens',
  'chart.title.day': '{date} Tokens',
  'chart.pickDate': '选择日期',
  'chart.dayLabel': '{month}月{day}日',
  'chart.bar': '{label}，共 {total} tokens',
  'datePicker.monthYear': '{year}年{month}月',
  'datePicker.weekdays': '一,二,三,四,五,六,日',
  'datePicker.today': '今天',
  'datePicker.prevMonth': '上个月',
  'datePicker.nextMonth': '下个月',
  'tip.input': '输入（未命中）',
  'tip.input.cached': '输入（命中缓存）',
  'state.loading': '加载中…',
  'state.refreshing': '正在更新，当前显示已保存的统计',
  'state.refreshError': '更新失败，已保留上次统计',
  'state.error': '用量加载失败',
  'state.retry': '重试',
  'state.empty': '这段时间还没有 token 用量',
  'model.title': '模型',
  'model.all': '全部模型',
  'model.count': '{count} 个模型',
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
  'range.1': 'Today',
  'range.7': '7d',
  'range.30': '30d',
  'cat.input': 'Input',
  'cat.cacheRead': 'Cache hit',
  'cat.output': 'Output',
  'requests': 'Requests',
  'card.input.sub': 'Hit rate {rate}%',
  'card.requests.sub': '{searches} web searches',
  'chart.title': 'Tokens per day',
  'chart.title.today': 'Tokens today',
  'chart.title.day': '{date} tokens',
  'chart.pickDate': 'Pick a date',
  'chart.dayLabel': '{month}/{day}',
  'chart.bar': '{label}, {total} tokens',
  'datePicker.monthYear': '{month}/{year}',
  'datePicker.weekdays': 'Mo,Tu,We,Th,Fr,Sa,Su',
  'datePicker.today': 'Today',
  'datePicker.prevMonth': 'Previous month',
  'datePicker.nextMonth': 'Next month',
  'tip.input': 'Input (miss)',
  'tip.input.cached': 'Input (cached)',
  'state.loading': 'Loading…',
  'state.refreshing': 'Updating; showing saved statistics',
  'state.refreshError': 'Update failed; saved statistics are still shown',
  'state.error': 'Could not load usage',
  'state.retry': 'Retry',
  'state.empty': 'No token usage in this window yet',
  'model.title': 'Model',
  'model.all': 'All models',
  'model.count': '{count} models',
} satisfies Record<UsageKey, string>
