import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import { ToolCallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import UsageStatsService from '../src/index.ts'
import type { UsageStatsValue } from '../src/index.ts'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadComposition(configPath: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root as string).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-sqlite', StorageSqlite],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@moonlight2893267956/dsh-usage-stats', UsageStatsService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

/** Local `YYYY-MM-DD` for today, matching the service's day bucket. */
function todayKey(): string {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function bucketFor(value: UsageStatsValue, date: string) {
  return value.buckets.find(candidate => candidate.date === date)
}

async function readStoredEventCount(ctx: Context, id: SessionId): Promise<number> {
  const reader = await ctx.sessionPersistence.open(id, 'read')
  try {
    return (await reader.read()).events.length
  } finally {
    await reader.close()
  }
}

describe('usage-stats through a real Loader composition', () => {
  it('serves per-day usage folded from the durable log and re-derives it across a warm restart', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-usage-stats-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'sessions'))}`,
      '    compression: none',
      '    writeBatchMaxDelayMs: 1',
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-sqlite'",
      '  config:',
      `    path: ${JSON.stringify(join(root, 'usage-stats.db'))}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: sqlite',
      "- name: '@moonlight2893267956/dsh-usage-stats'",
      '',
    ].join('\n'))

    const first = await loadComposition(configPath)
    // The Loader composed the plugin and activated its service. This profile
    // composes no web server, so the read route is not registered here — the
    // service still folds and answers.
    expect(first.usageStats).toBeInstanceOf(UsageStatsService)

    const session = first.sessions.create(SessionId('loader-usage'), { meta: { cwd: root } })
    const writer = await first.sessionPersistence.create(session.header)
    const callId = ToolCallId('call-1')
    const message = createAssistantMessage({
      content: [
        { type: 'text', text: 'answer' },
        { type: 'tool-call', id: callId, name: 'web_search', arguments: '{}' },
      ],
      source: { provider: 'test', model: 'test' },
    })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message,
      stream: [],
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50 },
    }, { surfaceOp: 'append' })
    session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'web_search',
      arguments: '{}',
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // Force the batched writes to the durable log before the fold reads them.
    await first.sessions.flush(session)
    await writer.close()
    await expect(readStoredEventCount(first, session.id)).resolves.toBe(7)

    const value = await first.usageStats.stats({ days: 30 })
    expect(bucketFor(value, todayKey())).toMatchObject({ input: 150, output: 20, cacheRead: 50, searches: 1 })

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    // A second composition over the same sqlite file opens the persisted
    // `usage_stats` checkpoint, so it seeds from the checkpoint instead of
    // rescanning the durable log.
    const second = await loadComposition(configPath)
    const again = await second.usageStats.stats({ days: 30 })
    expect(bucketFor(again, todayKey())).toMatchObject({ input: 150, output: 20, cacheRead: 50, searches: 1 })
  })
})
