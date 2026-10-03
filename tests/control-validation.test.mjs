import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorityFromPulseBlocks, createPulseBlock, frozenFeatures, independentPulseBlocks, stableWindowGuard } from '../analysis/control.mjs'

test('independent pulse blocks use stable windows and frozen pre-decision features', () => {
  const blocks = independentPulseBlocks({ family: 'obstructed.v1', runId: 'test-run', seed: 101, count: 3 })
  assert.equal(blocks.length, 3)
  assert.deepEqual(blocks.map(block => block.independentBlockId), ['test-run:pulse-0', 'test-run:pulse-1', 'test-run:pulse-2'])
  assert.ok(blocks.every(block => block.stableWindow.passed && block.noFutureLeakage))
  assert.deepEqual(blocks.map(block => block.excitedActuator), ['A', 'B', 'A'])
  assert.equal(new Set(blocks.map(block => block.independentBlockId)).size, blocks.length)
  const features = frozenFeatures(blocks[0].baseline, 5)
  assert.equal(features.windowEndSecond, 5)
  assert.equal(features.futureSamplesUsed, false)
  assert.ok(stableWindowGuard(blocks[0].baseline).passed)
})

test('authority validation rejects missing actuator excitation and duplicated response columns', () => {
  const onlyA = [0, 1].map(blockIndex => createPulseBlock({ family: 'normal.v1', runId: 'only-a', seed: 202, blockIndex, pulse: [0.4, 0] }))
  assert.throws(() => authorityFromPulseBlocks(onlyA), /Actuator B has no independent excitation/)

  const a = createPulseBlock({ family: 'normal.v1', runId: 'duplicate', seed: 202, blockIndex: 0, pulse: [0.4, 0] })
  const b = createPulseBlock({ family: 'normal.v1', runId: 'duplicate', seed: 202, blockIndex: 1, pulse: [0, 0.4] })
  b.baseline = structuredClone(a.baseline)
  b.intervention = structuredClone(a.intervention)
  assert.throws(() => authorityFromPulseBlocks([a, b]), /response columns are duplicated/)
})

test('pulse authority is finite and sign-consistent', () => {
  const authority = authorityFromPulseBlocks(independentPulseBlocks({ family: 'normal.v1', runId: 'authority', seed: 202, count: 3 }))
  assert.equal(authority.cooling.length, 6)
  assert.ok(authority.cooling.flat().every(value => Number.isFinite(value) && value >= 0))
  assert.deepEqual(authority.excitedActuators.sort(), ['A', 'B'])
  assert.ok(authority.cooling.some(row => Math.abs(row[0] - row[1]) > 0.000001))
  assert.equal(authority.source, 'CANONICAL_VERSIONED_PLANT_VIRTUAL_DEVICE')
})

test('correctable family pulse authority remains canonical and independent', () => {
  const blocks = independentPulseBlocks({ family: 'correctable.v1', runId: 'correctable', seed: 101, count: 3 })
  const authority = authorityFromPulseBlocks(blocks)
  assert.equal(blocks.every(block => block.canonicalSimulator.source === 'VERSIONED_PLANT_VIRTUAL_DEVICE'), true)
  assert.ok(authority.cooling[0].some(value => value > authority.uncertainty))
})
