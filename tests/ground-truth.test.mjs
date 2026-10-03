import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySyntheticLabel, assertLabel } from '../analysis/labels.mjs'

test('declared synthetic families produce only the closed ground-truth labels', () => {
  const cases = [
    ['normal.v1', 'ABSTAIN'],
    ['obstructed.v1', 'ABSTAIN'],
    ['capacity.v1', 'CAPACITY_OR_EQUIPMENT_FAULT'],
    ['fault-matrix.v1', 'SENSOR_OR_EVENT_ARTIFACT'],
    ['correctable.v1', 'ABSTAIN'],
  ]
  for (const [family, expected] of cases) {
    const label = classifySyntheticLabel({ family, runId: 'run', seed: 2026, evidence: { stale: false } })
    assert.equal(label.label, expected)
    assert.equal(label.evidenceClass, 'SIMULATED')
    assertLabel(label)
  }
  assert.equal(classifySyntheticLabel({ family: 'obstructed.v1', runId: 'run', seed: 2026, evidence: { boundedInterventionObserved: true, boundedInterventionPassed: true, authoritySufficient: true } }).label, 'CORRECTABLE')
  assert.equal(classifySyntheticLabel({ family: 'correctable.v1', runId: 'run', seed: 2026, evidence: { initialExcursion: true, boundedInterventionPassed: true, authoritySufficient: true } }).label, 'CORRECTABLE')
  assert.equal(classifySyntheticLabel({ family: 'normal.v1', runId: 'run', seed: 2026, evidence: { noExcursion: true, boundedInterventionPassed: true, authoritySufficient: true } }).reason, 'NO_EXCURSION_ALREADY_IN_TARGET')
})

test('insufficient, stale, contradictory, and replayed-as-live evidence abstain or remain unknown', () => {
  for (const evidence of [{ insufficient: true }, { stale: true }, { contradictory: true }, { replayedAsLive: true }]) {
    const label = classifySyntheticLabel({ family: 'obstructed.v1', runId: 'run', seed: 2026, evidence })
    assert.ok(['UNKNOWN', 'ABSTAIN'].includes(label.label))
    assert.equal(label.intervention, 'NONE')
  }
  const replayedAsLive = classifySyntheticLabel({ family: 'obstructed.v1', runId: 'run', seed: 2026, evidenceClass: 'LIVE_TABLETOP', source: 'REPLAY' })
  assert.equal(replayedAsLive.label, 'ABSTAIN')
  assert.equal(replayedAsLive.evidenceClass, 'LIVE_TABLETOP')
})
