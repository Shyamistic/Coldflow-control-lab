import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorityFromPulseBlocks, frozenFeatures, independentPulseBlocks, stableWindowGuard } from '../analysis/control.mjs'

test('independent pulse blocks use stable windows and frozen pre-decision features', () => {
  const blocks = independentPulseBlocks({ family: 'obstructed.v1', runId: 'test-run', seed: 101, count: 3 })
  assert.equal(blocks.length, 3)
  assert.deepEqual(blocks.map(block => block.independentBlockId), ['test-run:pulse-0', 'test-run:pulse-1', 'test-run:pulse-2'])
  assert.ok(blocks.every(block => block.stableWindow.passed && block.noFutureLeakage))
  assert.equal(new Set(blocks.map(block => block.independentBlockId)).size, blocks.length)
  const features = frozenFeatures(blocks[0].baseline, 5)
  assert.equal(features.windowEndSecond, 5)
  assert.equal(features.futureSamplesUsed, false)
  assert.ok(stableWindowGuard(blocks[0].baseline).passed)
})

test('pulse authority is finite and sign-consistent', () => {
  const authority = authorityFromPulseBlocks(independentPulseBlocks({ family: 'normal.v1', runId: 'authority', seed: 202, count: 3 }))
  assert.equal(authority.cooling.length, 6)
  assert.ok(authority.cooling.flat().every(value => Number.isFinite(value) && value >= 0))
  assert.equal(authority.source, 'INDEPENDENT_SYNTHETIC_PULSES')
})
