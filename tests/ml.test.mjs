import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateModel } from '../ml/evaluate.mjs'
import { sha256 } from '../ml/features.mjs'
import { trainCandidate } from '../ml/train.mjs'
import { advisoryFromModel } from '../src/advisory.ts'

async function fixture() {
  const text = await readFile('artifacts/simulation/evaluation.json', 'utf8')
  return { report: JSON.parse(text), reportHash: sha256(text) }
}

test('training is deterministic and uses disjoint family holdouts', async () => {
  const { report, reportHash } = await fixture()
  const options = { families: ['normal.v1', 'obstructed.v1', 'capacity.v1'], seeds: [101, 202, 303, 404], reportHash }
  const first = trainCandidate(report, options)
  const second = trainCandidate(report, options)
  assert.deepEqual(first, second)
  assert.match(first.artifactHash, /^[a-f0-9]{64}$/)
  for (const fold of first.grouping.folds) assert.equal(new Set(fold.trainGroups).intersection(new Set(fold.holdoutGroups)).size, 0)
  assert.equal(first.safety.directActuatorWrite, false)
  assert.equal(first.provenance.physicalHardwareAssembled, false)
})

test('held-out evaluation reports required safety and selection metrics', async () => {
  const { report, reportHash } = await fixture()
  const model = trainCandidate(report, { families: ['normal.v1', 'obstructed.v1', 'capacity.v1'], seeds: [101, 202, 303, 404], reportHash })
  const evaluation = evaluateModel(model)
  assert.equal(evaluation.protocol.futureLeakage, false)
  assert.equal(evaluation.grouping.groupOverlap, false)
  assert.ok(evaluation.metrics.calibration)
  assert.ok(evaluation.metrics.confusion)
  assert.ok(evaluation.metrics.ood.total > 0)
  assert.ok(evaluation.metrics.seedSensitivity)
  assert.ok(evaluation.metrics.resource.modelBytes > 0)
  assert.ok(evaluation.metrics.falseCorrectable)
  assert.equal(evaluation.provenance.directActuatorWrite, false)
  assert.equal(evaluation.selection.decision, 'NO_ML_BASELINE')
})

test('advisory integration cannot provide actuator authority', () => {
  const advisory = advisoryFromModel({ label: 'CORRECTABLE', reason: 'TEST_ONLY', confidence: 0.8 })
  assert.equal(advisory.modelAdvisoryOnly, true)
  assert.equal(advisory.directActuatorWrite, false)
  assert.deepEqual(advisory.safeOutput, [0, 0])
})
