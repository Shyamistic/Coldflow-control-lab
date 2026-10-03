import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shield, driverAccept, validSafety, chooseAction, createPlant, identifyAuthority, runExperiment, stepPlant, exportCsv } from '../src/domain.ts'
import type { Context, Scenario, Method } from '../src/domain.ts'

test('shield permits only bounded fresh sequenced commands and limits upward slew', () => {
  assert.deepEqual(shield(validSafety()).fans, [0.1, 0.1])
  assert.equal(shield(validSafety({ previous: [0.4, 0.4] })).permitted, true)
})
test('every disturbed context disables added fans', () => {
  for (const context of ['DOOR_OPEN', 'DEFROST', 'DRIP', 'FAN_DELAY', 'POST_EVENT_RECOVERY', 'SOURCE_UNKNOWN'] as Context[]) assert.deepEqual(shield(validSafety({ context })).fans, [0, 0])
})
test('expiry, replay, interlocks, faults and invalid values reject', () => {
  const faults = [{ leaseUntilMs: 1000 }, { operatorApproved: false }, { measuredAtMs: -2000 }, { measuredAtMs: 1001 }, { sequence: 0 }, { sequence: 0.5 }, { interlockClosed: false }, { sourceProven: false }, { actuatorHealthy: false }, { wet: true }, { surfaceMinimum: null }, { dewPoint: 3 }, { combinedU95: NaN }, { temperatures: [NaN] }, { requested: [1, 0] }, { previous: [-1, 0] }, { nowMs: NaN }]
  for (const fault of faults) assert.equal(shield(validSafety(fault as Parameters<typeof validSafety>[0])).permitted, false, JSON.stringify(fault))
})
test('driver independently rejects stale or repeated shield output', () => {
  const output = shield(validSafety())
  assert.deepEqual(driverAccept(output, 1000, 0), [0.1, 0.1])
  assert.deepEqual(driverAccept(output, 1200, 0), [0, 0])
  assert.deepEqual(driverAccept(output, 1000, 1), [0, 0])
  assert.deepEqual(driverAccept(output, 900, 0), [0, 0])
})
test('blocked response leads inspection/abstention, never a restack diagnosis', () => {
  const plant = createPlant('blocked')
  const action = chooseAction(plant.temperatures, identifyAuthority(plant), plant.supply)
  assert.equal(action.state, 'ABSTAIN')
  assert.equal(action.reason, 'INSUFFICIENT_AUTHORITY_INSPECT_PATH')
})
test('inadequate source and changed model envelope cannot trigger correction', () => {
  const plant = createPlant('capacity')
  assert.equal(chooseAction(plant.temperatures, identifyAuthority(plant), plant.supply).state, 'INVESTIGATE_EQUIPMENT')
  const normal = createPlant('partial')
  assert.equal(chooseAction(normal.temperatures, identifyAuthority(normal), normal.supply, 2).reason, 'MODEL_OUT_OF_ENVELOPE')
})
test('no excursion requires no added flow', () => {
  const plant = createPlant('normal')
  assert.deepEqual(chooseAction(plant.temperatures, identifyAuthority(plant), plant.supply).fans, [0, 0])
})
test('integration exposes power and degree-minutes with correct units', () => {
  const plant = createPlant('partial')
  const next = stepPlant(plant, [1, 1], 1)
  assert.equal(next.fanWh, 16 / 3600)
  const expected = next.temperatures.reduce((sum, value) => sum + Math.max(0, value - 8), 0) / 60
  assert.equal(next.hotDegreeMinutes, expected)
  assert.throws(() => stepPlant(plant, [1, 1], 10))
})
test('all scenario and comparator runs remain finite, bounded and deterministic', () => {
  for (const scenario of ['partial', 'blocked', 'capacity', 'sensor', 'actuator', 'normal'] as Scenario[]) {
    for (const method of ['fixed-normal', 'fixed-high', 'expert-rule', 'identified', 'path-clear'] as Method[]) {
      const run = runExperiment(scenario, method, 120)
      assert.equal(run.evidenceClass, 'SIMULATION')
      for (const sample of run.samples) {
        assert.ok(sample.temperatures.every(Number.isFinite))
        assert.ok(sample.fans.every(value => value >= 0 && value <= 0.8))
        assert.ok(sample.hdt >= 0 && sample.cdt >= 0 && sample.fanWh >= 0)
      }
    }
  }
  assert.deepEqual(runExperiment('partial', 'identified', 120), runExperiment('partial', 'identified', 120))
  assert.ok(exportCsv(runExperiment('partial', 'identified', 10)).includes('SIMULATION,partial,identified'))
})
test('synthetic configuration sweep is model evidence, not independent measured validation', () => {
  const outcomes = [101, 202, 303, 404].map(seed => runExperiment('partial', 'identified', 600, seed))
  assert.ok(outcomes.every(run => run.protocol.includes('not independent physical evidence')))
  const fault = runExperiment('sensor', 'identified', 120).samples.at(-1)!
  assert.equal(fault.state, 'SAFE_FALLBACK')
  assert.deepEqual(fault.fans, [0, 0])
})