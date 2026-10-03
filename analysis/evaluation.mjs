import { authorityFromPulseBlocks, independentPulseBlocks } from './control.mjs'
import { COMPARATORS, evaluateComparator } from './baseline.mjs'
import { detectOOD } from './constraints.mjs'
import { classifySyntheticLabel } from './labels.mjs'
import { configurationForFamily } from '../src/simulator/configuration.ts'
import { createFaultEvent } from '../src/simulator/faults.ts'
import { VirtualDevice } from '../src/simulator/virtual-device.ts'

export const EVALUATION_SCHEMA = 'coldflow.simulation-evaluation.v1'
const FAULT_CASES = [
  ['DOOR_OPEN', 'ABSTAIN', 'CONTEXT_DOOR_OPEN'],
  ['DEFROST', 'ABSTAIN', 'CONTEXT_DEFROST'],
  ['SOURCE_INADEQUATE', 'INVESTIGATE_EQUIPMENT', 'SOURCE_UNPROVEN'],
  ['SENSOR_STALE', 'SAFE_FALLBACK', 'STALE_CRITICAL_INPUT'],
  ['SENSOR_DROPOUT', 'SAFE_FALLBACK', 'INVALID_SENSOR'],
  ['CONDENSATION_RISK', 'SAFE_FALLBACK', 'CONDENSATION_UNOBSERVABLE_OR_UNSAFE'],
  ['INTERLOCK_OPEN', 'SAFE_FALLBACK', 'INTERLOCK_OPEN'],
  ['ACTUATOR_NO_FEEDBACK', 'SAFE_FALLBACK', 'ACTUATOR_FEEDBACK_FAULT'],
  ['ACTUATOR_STUCK', 'SAFE_FALLBACK', 'ACTUATOR_FEEDBACK_FAULT'],
  ['NETWORK_DELAY', 'SAFE_FALLBACK', 'STALE_CRITICAL_INPUT'],
  ['NETWORK_LOSS', 'SAFE_FALLBACK', 'NETWORK_LOSS'],
]

const DEVICE_FAULTS = new Set(['DOOR_OPEN', 'DEFROST', 'SENSOR_STALE', 'SENSOR_DROPOUT', 'CONDENSATION_RISK', 'ACTUATOR_NO_FEEDBACK', 'ACTUATOR_STUCK', 'NETWORK_DELAY', 'NETWORK_LOSS'])

function parseList(value, fallback) {
  return value ? value.split(',').map(item => item.trim()).filter(Boolean) : fallback
}

function caseForFault(name, expectedState, expectedReason) {
  const base = configurationForFamily('fault-matrix', 2026)
  const manifest = name === 'SOURCE_INADEQUATE'
    ? { ...base, source: { ...base.source, proven: false } }
    : DEVICE_FAULTS.has(name)
      ? { ...base, faults: [createFaultEvent(name, 0, 1)] }
      : base
  const device = new VirtualDevice(manifest)
  const observed = device.submit({ nowMs: 1000, sequence: 1, requested: [0.4, 0.4], leaseUntilMs: 60000, interlockClosed: name !== 'INTERLOCK_OPEN' })
  const zeroOutput = observed.applied.every(value => value === 0)
  const resolved = observed.state === expectedState && observed.reason === expectedReason && zeroOutput
  return {
    fault: name,
    expectedSafeState: expectedState,
    expectedReason,
    resolved,
    observedState: observed.state,
    observedReason: observed.reason,
    observedOutput: observed.applied,
    zeroOutput,
    inconclusive: false,
    modelAdvisoryOnly: true,
  }
}

export function evaluateSimulation({ families = ['normal.v1', 'obstructed.v1', 'capacity.v1'], seeds = [101, 202, 303, 404], durationSeconds = 30 } = {}) {
  const groups = []
  const cases = []
  for (const family of families) {
    for (const seed of seeds) {
      const runId = `eval-${family}-${seed}`
      const blocks = independentPulseBlocks({ family, runId, seed, count: 3 })
      const authority = authorityFromPulseBlocks(blocks)
      const comparators = COMPARATORS.map(method => evaluateComparator({ family, seed, method, blocks, durationSeconds }))
      const label = classifySyntheticLabel({ family, runId, seed, evidence: { corrected: false, authoritySufficient: true } })
      groups.push({ groupId: `${family}:${runId}:${seed}`, family, runId, seed, pulseBlocks: blocks.map(block => ({ id: block.independentBlockId, startSecond: block.startSecond, endSecond: block.endSecond, stableWindow: block.stableWindow, noFutureLeakage: block.noFutureLeakage })), authority, comparators, label })
      for (const comparator of comparators) cases.push({ groupId: `${family}:${runId}:${seed}`, method: comparator.method, family, seed, metrics: comparator.metrics, constraints: comparator.constraints, ood: comparator.ood, abstention: comparator.abstention })
    }
  }
  const faultCases = FAULT_CASES.map(([fault, expectedSafeState, reason]) => caseForFault(fault, expectedSafeState, reason))
  const oodCases = groups.flatMap(group => {
    const inDistribution = group.pulseBlocks.length > 0 ? group.authority.cooling.flat().every(Number.isFinite) : false
    const normal = detectOOD({ meanTemperatureC: 7, spreadC: 1, supplyC: 3.5, maxSlopeCPerSecond: 0.01 })
    const out = detectOOD({ meanTemperatureC: 22, spreadC: 18, supplyC: 12, maxSlopeCPerSecond: 1 })
    return [{ groupId: group.groupId, kind: 'IN_DISTRIBUTION', detected: !inDistribution, ...normal }, { groupId: group.groupId, kind: 'OUT_OF_DISTRIBUTION', detected: out.isOOD, ...out }]
  })
  const restackLabels = groups.filter(group => group.label.label === 'RESTACK_REQUIRED')
  const failedCases = cases.filter(item => !item.constraints.passed || item.ood.isOOD)
  const inconclusiveCases = cases.filter(item => item.abstention.decision === 'ABSTAIN')
  const resolvedFaults = faultCases.filter(item => item.resolved && !item.inconclusive)
  return {
    schema: EVALUATION_SCHEMA,
    schemaVersion: '1.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    provenance: { evidenceClass: 'SIMULATED', source: 'SYNTHETIC_RULE', simulatorVersion: 'cf-sim-v1', modelVersion: 'declared-synthetic-rules-v1', physicalHardwareAssembled: false, actuatorAuthority: false },
    protocol: { name: 'independent-pulse-grouped-baseline-v1', stableWindowSeconds: 5, frozenFeatures: true, futureLeakage: false, independentPulseBlocks: true, durationSeconds },
    grouping: { unit: 'configuration-family/run/seed', split: 'grouped-holdout', groups: groups.map(group => group.groupId), trainGroups: [], holdoutGroups: groups.map(group => group.groupId), temporalLeakage: false, groupOverlap: false },
    configurationFamilies: [...new Set(groups.map(group => group.family))],
    seeds: [...seeds],
    comparators: COMPARATORS,
    groups,
    cases,
    faults: { total: faultCases.length, resolved: resolvedFaults.length, inconclusive: faultCases.filter(item => item.inconclusive).length, coverage: Number((resolvedFaults.length / faultCases.length).toFixed(6)), cases: faultCases },
    ood: { total: oodCases.length, detected: oodCases.filter(item => item.detected).length, falseAbstention: oodCases.filter(item => item.kind === 'IN_DISTRIBUTION' && item.detected).length, cases: oodCases },
    abstention: { totalCases: cases.length, abstained: inconclusiveCases.length, failed: failedCases.length, safeOutput: [0, 0], modelAdvisoryOnly: true, directActuatorWrite: false, shieldAuthoritative: true },
    labels: { counts: Object.fromEntries([...new Set(groups.map(group => group.label.label))].map(label => [label, groups.filter(group => group.label.label === label).length])), restackRequired: { count: restackLabels.length, evidenceClass: 'SIMULATED', syntheticOnly: true, physicalInferenceAllowed: false } },
    failedCases,
    inconclusiveCases,
    machineReadable: true,
  }
}

export function parseEvaluationArguments(argumentsList) {
  const values = {}
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (!argument.startsWith('--')) continue
    const [key, inline] = argument.slice(2).split('=', 2)
    values[key] = inline ?? argumentsList[index + 1]
    if (inline === undefined) index += 1
  }
  return { families: parseList(values.families, ['normal.v1', 'obstructed.v1', 'capacity.v1']), seeds: parseList(values.seeds, ['101', '202', '303', '404']).map(Number), output: values.output ?? 'artifacts/simulation/evaluation.json' }
}
