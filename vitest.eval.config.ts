import { defineConfig } from 'vitest/config'

// `npm run eval`: scores movement detection on the videos in /testset.
export default defineConfig({
  test: { environment: 'node', include: ['scripts/*.eval.ts'], testTimeout: 600_000 },
})
