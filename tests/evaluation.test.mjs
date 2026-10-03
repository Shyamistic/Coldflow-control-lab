import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSimulation } from '../analysis/evaluation.mjs'
import { classifySyntheticLabel } from '../analysis/labels.mjs'
import { FAULT_NAMES } from '../src/simulator/faults.ts'

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
  assert.equal(report.faults.declaredFaultNames.includes('HUMIDITY_HIGH'), true)
  for (const fault of FAULT_NAMES) assert.equal(report.faults.cases.some(item => item.fault === fault && ['PASSED', 'INCONCLUSIVE'].includes(item.status)), true, fault)
  assert.equal(report.faults.cases.some(item => item.fault === 'HUMIDITY_HIGH' && item.status === 'PASSED'), true)
  assert.equal(report.groups.every(group => group.canonicalSimulator.source === 'VERSIONED_PLANT_VIRTUAL_DEVICE'), true)
  assert.ok(report.ood.cases.some(item => item.kind === 'OUT_OF_DISTRIBUTION' && item.detected))
  assert.ok(report.abstention.abstained > 0)
  assert.equal(report.labels.restackRequired.syntheticOnly, true)
  assert.ok(report.failedCases.every(item => item.groupId && item.method))
})

test('obstructed labels abstain without matched intervention evidence', () => {
  const label = classifySyntheticLabel({ family: 'obstructed.v1', runId: 'insufficient', evidence: { boundedInterventionObserved: true, robustReachabilityFailed: true, matchedPathClearImproved: false } })
  assert.equal(label.label, 'ABSTAIN')
})

test('obstructed labels require observed failure and matched path-clear improvement', () => {
  const label = classifySyntheticLabel({ family: 'obstructed.v1', runId: 'matched', evidence: { boundedInterventionObserved: true, robustReachabilityFailed: true, matchedPathClearImproved: true } })
  assert.equal(label.label, 'RESTACK_REQUIRED')
})

test('evaluation requires a matched canonical path-clear authority change for RESTACK_REQUIRED', () => {
  const report = evaluateSimulation({ families: ['obstructed.v1'], seeds: [101] })
  const group = report.groups[0]
  const identified = group.comparators.find(comparator => comparator.method === 'identified')
  const pathClear = group.comparators.find(comparator => comparator.method === 'path-clear')
  assert.equal(group.matchedPathClearEvidence.matchedInitialConditions, true)
  assert.equal(group.matchedPathClearEvidence.authorityChanged, true)
  assert.equal(group.interventionEvidence.robustReachabilityFailed, identified.constraints.reachable === false)
  assert.equal(group.interventionEvidence.matchedPathClearImproved, identified.constraints.reachable === false && pathClear.constraints.reachable === true)
  assert.equal(group.label.label, 'RESTACK_REQUIRED')
})

test('correctable family declares an excursion and records a passing bounded comparator', () => {
  const report = evaluateSimulation({ families: ['correctable.v1'], seeds: [101] })
  const group = report.groups[0]
  const identified = group.comparators.find(comparator => comparator.method === 'identified')
  assert.deepEqual(identified.constraints.initialTargetZones, [0])
  assert.equal(identified.constraints.reachabilityOutcome, 'CORRECTED')
  assert.equal(identified.constraints.passed, true)
  assert.equal(identified.metrics.reachabilityOutcome, 'CORRECTED')
  assert.equal(group.label.label, 'CORRECTABLE')
  assert.equal(group.outcome, 'CORRECTED')
  assert.equal(group.canonicalSimulator.source, 'VERSIONED_PLANT_VIRTUAL_DEVICE')
  assert.equal(identified.directActuatorWrite, false)
})

test('normal no-excursion is a safe no-action outcome', () => {
  const report = evaluateSimulation({ families: ['normal.v1'], seeds: [101] })
  const group = report.groups[0]
  const identified = group.comparators.find(comparator => comparator.method === 'identified')
  assert.equal(identified.constraints.reachabilityOutcome, 'NO_EXCURSION')
  assert.equal(identified.constraints.reachable, true)
  assert.equal(identified.constraints.passed, true)
  assert.equal(identified.abstention.decision, 'NO_ACTION')
  assert.equal(group.action, 'NO_ACTION')
  assert.equal(group.label.reason, 'NO_EXCURSION_ALREADY_IN_TARGET')
})
test('evaluation output is deterministic for identical groups', () => {
  const options = { families: ['normal.v1'], seeds: [101] }
  assert.deepEqual(evaluateSimulation(options), evaluateSimulation(options))
})
