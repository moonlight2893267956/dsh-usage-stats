/** Diagnostic only: built service/persistence calls over fixed synthetic histories. */
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as Json from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import Candidate from '../lib/index.js'

const require = createRequire(import.meta.url)
const baselinePath = process.argv[2]
if (!baselinePath) throw new Error('Supply the unmodified installed lib/index.js path')
let baselineCode = await readFile(baselinePath, 'utf8')
for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-session-persistence', '@deepseek-ai/dsh-storage-domain', 'zod']) {
  baselineCode = baselineCode.replaceAll(`from "${name}"`, `from "${pathToFileURL(require.resolve(name)).href}"`)
}
const { default: Baseline } = await import(`data:text/javascript;base64,${Buffer.from(baselineCode).toString('base64')}`)
const count = Number(process.argv[3] ?? 128)
const turns = Number(process.argv[4] ?? 20)
const root = await mkdtemp(join(tmpdir(), 'usage-perf-'))
const request = { days: 30 }
async function mount(Service) {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(Storage)
    await ctx.plugin(Json, { root: join(root, 'checkpoint') })
    await ctx.plugin(Domain, { backend: 'json' })
    await ctx.plugin(Service)
    return ctx
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
const contexts = []
try {
  const setup = await mount(Baseline); contexts.push(setup)
  for (let i = 0; i < count; i++) {
    const session = setup.sessions.create(SessionId(`synthetic-${i}`), { meta: { cwd: join(root, 'project') } })
    const writer = await setup.sessionPersistence.create(session.header)
    for (let turn = 1; turn <= turns; turn++) {
      session.append('turn/start', { turn })
      session.append('step/start', { turn, step: 1 })
      session.append('assistant/message', { turn, step: 1, stream: [],
        message: createAssistantMessage({ content: [{ type: 'text', text: 'x'.repeat(2048) }], source: { provider: 'synthetic', model: `model-${i % 4}` } }),
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50 },
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    await setup.sessions.flush(session); await writer.close()
  }
  const first = performance.now(); const expected = await setup.usageStats.stats(request)
  const uncachedBackfillMs = performance.now() - first
  await setup.fiber.dispose(); contexts.splice(contexts.indexOf(setup), 1)
  const samples = []
  for (let i = 0; i < 3; i++) {
    const baseline = await mount(Baseline); contexts.push(baseline)
    const t = performance.now(); const original = await baseline.usageStats.stats(request); const baselineFirstMs = performance.now() - t
    await baseline.fiber.dispose(); contexts.splice(contexts.indexOf(baseline), 1)
    const candidate = await mount(Candidate); contexts.push(candidate)
    const c = performance.now(); const snapshot = candidate.usageStats.cachedSnapshot(request); const candidateFirstMs = performance.now() - c
    if (JSON.stringify(snapshot.value) !== JSON.stringify(original) || JSON.stringify(original) !== JSON.stringify(expected)) throw new Error('aggregate differs')
    await candidate.usageStats.stats(request); const candidateReadyMs = performance.now() - c
    const h = performance.now(); await candidate.usageStats.stats(request); const hotMs = performance.now() - h
    samples.push({ baselineFirstMs, candidateFirstMs, candidateReadyMs, hotMs, heapMiB: process.memoryUsage().heapUsed / 1048576 })
    await candidate.fiber.dispose(); contexts.splice(contexts.indexOf(candidate), 1)
  }
  console.log(JSON.stringify({ workload: { sessions: count, turns, eventsPerTurn: 5, assistantTextBytes: 2048, models: 4 }, uncachedBackfillMs, samples,
    endpoint: 'baseline: strict current totals; candidateFirst: explicitly stale committed snapshot; candidateReady: strict current totals',
    exclusions: 'No HTTP, browser paint, model/network latency, or cold OS disk cache; heap is transient diagnostic, not retained-memory budget' }, null, 2))
} finally {
  await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
  await rm(root, { recursive: true, force: true })
}
