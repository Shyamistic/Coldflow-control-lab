import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCanonicalExperiment } from '../src/simulator/public-experiment.ts'

test('canonical public experiment identity is deterministic and versioned', () => {
  const first = runCanonicalExperiment('partial', 'identified', 20, 2026)
  const second = runCanonicalExperiment('partial', 'identified', 20, 2026)
  assert.deepEqual(first, second)
  assert.equal(first.evidenceClass, 'SIMULATION')
  assert.equal(first.provenance.evidenceClass, 'SIMULATED')
  assert.equal(first.provenance.executionPath, 'VERSIONED_PLANT_VIRTUAL_DEVICE')
  assert.equal(first.provenance.simulatorVersion, 'cf-sim-v1')
  assert.equal(first.provenance.hardwareConnected, false)
  assert.equal(first.provenance.directActuatorWrite, false)
  assert.equal(first.provenance.manifestHash, first.manifestHash)
  assert.equal(first.provenance.configurationHash, first.configurationHash)
  assert.equal(first.provenance.outputHash, first.outputHash)
})

test('canonical adapter keeps safe fallback and no-excursion behavior', () => {
  const normal = runCanonicalExperiment('normal', 'identified', 10)
  assert.equal(normal.samples.at(-1)?.state, 'OBSERVE')
  assert.deepEqual(normal.samples.at(-1)?.fans, [0, 0])
  const blocked = runCanonicalExperiment('blocked', 'identified', 10)
  assert.ok(blocked.samples.some(sample => sample.state === 'ABSTAIN'))
  assert.ok(blocked.samples.every(sample => sample.fans.every(value => value === 0)))
  const sensor = runCanonicalExperiment('sensor', 'identified', 120)
  assert.equal(sensor.samples.at(-1)?.state, 'SAFE_FALLBACK')
  assert.deepEqual(sensor.samples.at(-1)?.fans, [0, 0])
})
