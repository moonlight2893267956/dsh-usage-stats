import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'
import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('@moonlight2893267956/dsh-usage-stats', ['lib/types/index.js'], {
  hostPhase: true,
  lib: { plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] },
})
