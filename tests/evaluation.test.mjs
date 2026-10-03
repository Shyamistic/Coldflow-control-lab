import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSimulation } from '../analysis/evaluation.mjs'

test('evaluation is grouped, machine-readable, and provenance bounded', () => {
  const report = evaluateSimulation({ families: ['normal.v1', 'obstructed.v1', 'capacity.v1'], seeds: [101, 202] })
  assert.equal(report.schema, 'coldflow.simulation-evaluation.v1')
  assert.equal(report.groups.length, 6)
  assert.equal(report.cases.length, 30)
  assert.equal(report.grouping.temporalLeakage, false)
  assert.equal(report.protocol.independentPulseBlocks, true)
  assert.equal(report.protocol.frozenFeatures, true)
  assert.equal(report.provenance.actuatorAuthority, false)
  assert.equal(report.faults.resolved, report.faults.total)
  assert.ok(report.ood.cases.some(item => item.kind === 'OUT_OF_DISTRIBUTION' && item.detected))
  assert.ok(report.abstention.abstained > 0)
  assert.equal(report.labels.restackRequired.syntheticOnly, true)
  assert.ok(report.failedCases.every(item => item.groupId && item.method))
})

test('evaluation output is deterministic for identical groups', () => {
  const options = { families: ['normal.v1'], seeds: [101] }
  assert.deepEqual(evaluateSimulation(options), evaluateSimulation(options))
})
