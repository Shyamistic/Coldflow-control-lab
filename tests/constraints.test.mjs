import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTrajectoryConstraints, safeAbstention } from '../analysis/constraints.mjs'

const sample = temperaturesC => ({ temperaturesC })

test('normal no-excursion is already in target and never unreachable', () => {
  const constraints = evaluateTrajectoryConstraints({ trajectory: [sample([6, 6, 6, 6, 6, 6]), sample([6.1, 6, 6, 6, 6, 6])] })
  assert.equal(constraints.reachable, true)
  assert.equal(constraints.reachabilityOutcome, 'NO_EXCURSION')
  assert.equal(constraints.outcome, 'NO_EXCURSION')
  assert.equal(constraints.reasons.includes('UNREACHABLE_TARGET'), false)
  assert.equal(constraints.passed, true)
  assert.equal(safeAbstention({ constraints }).decision, 'NO_ACTION')
})

test('declared initial excursion reaches the bounded target without weakening constraints', () => {
  const constraints = evaluateTrajectoryConstraints({
    trajectory: [sample([8.15, 7, 7, 7, 7, 7]), sample([7.95, 7, 7, 7, 7, 7])],
    actions: [{ duty: [0.4, 0.4] }],
  })
  assert.deepEqual(constraints.initialTargetZones, [0])
  assert.equal(constraints.reachabilityOutcome, 'CORRECTED')
  assert.equal(constraints.reachable, true)
  assert.equal(constraints.passed, true)
})

test('warm target that remains above the limit is unreachable and abstains', () => {
  const constraints = evaluateTrajectoryConstraints({
    trajectory: [sample([10, 7, 7, 7, 7, 7]), sample([9.9, 7, 7, 7, 7, 7])],
  })
  assert.equal(constraints.reachabilityOutcome, 'UNREACHABLE')
  assert.equal(constraints.reachable, true)
  assert.equal(constraints.reasons.includes('UNREACHABLE_TARGET'), true)
  assert.equal(safeAbstention({ constraints }).decision, 'ABSTAIN')
})
