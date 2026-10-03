import { authorityFromPulseBlocks, independentPulseBlocks, pathClearManifest } from './control.mjs'
import { COMPARATORS, evaluateComparator } from './baseline.mjs'
import { detectOOD } from './constraints.mjs'
import { classifySyntheticLabel } from './labels.mjs'
import { configurationForFamily, manifestWithSeed } from '../src/simulator/configuration.ts'
import { FAULT_BEHAVIORS, FAULT_NAMES, createFaultEvent } from '../src/simulator/faults.ts'
import { faultMatrixConfiguration } from '../src/simulator/configurations/fault-matrix.ts'
import { VirtualDevice } from '../src/simulator/virtual-device.ts'
import { hashCanonical } from '../recorder/manifest.mjs'

export const EVALUATION_SCHEMA = 'coldflow.simulation-evaluation.v1'

const POLICY_CASES = [
  { fault: 'SOURCE_INADEQUATE', expectedSafeState: 'INVESTIGATE_EQUIPMENT', expectedReason: 'SOURCE_UNPROVEN' },
  { fault: 'INTERLOCK_OPEN', expectedSafeState: 'SAFE_FALLBACK', expectedReason: 'INTERLOCK_OPEN' },
]

function parseList(value, fallback) {
  return value ? value.split(',').map(item => item.trim()).filter(Boolean) : fallback
}

function finalHotTemperature(comparator) {
  return Math.max(...comparator.trajectory.at(-1).temperaturesC)
}

function faultManifest(name) {
  const base = configurationForFamily('fault-matrix', 2026)
  if (name === 'SOURCE_INADEQUATE') return manifestWithSeed({ ...base, source: { ...base.source, proven: false } }, 2026)
  if (name === 'INTERLOCK_OPEN') return base
  return manifestWithSeed({ ...base, faults: [createFaultEvent(name, 0, 1)] }, 2026)
}

function caseForFault({ fault, expectedSafeState, expectedReason, declaredBy = 'POLICY_CONTRACT' }) {
  const manifest = faultManifest(fault)
  const device = new VirtualDevice(manifest)
  const observed = device.submit({ nowMs: 1000, sequence: 1, requested: [0.4, 0.4], leaseUntilMs: 60000, interlockClosed: fault !== 'INTERLOCK_OPEN' })
  const zeroOutput = observed.applied.every(value => value === 0)
  const resolved = observed.state === expectedSafeState && observed.reason === expectedReason && zeroOutput
  return {
    fault,
    declaredBy,
    expectedSafeState,
    expectedReason,
    resolved,
    status: resolved ? 'PASSED' : 'FAILED',
    observedState: observed.state,
    observedReason: observed.reason,
    observedOutput: observed.applied,
    zeroOutput,
    inconclusive: false,
    modelAdvisoryOnly: true,
    canonicalSimulator: { source: 'VERSIONED_PLANT_VIRTUAL_DEVICE', simulatorVersion: 'cf-sim-v1', manifestHash: manifest.manifestHash },
  }
}

function declaredFaultCases() {
  const scheduled = new Set(faultMatrixConfiguration.faults.map(event => event.name))
  return [
    ...FAULT_NAMES.map(fault => {
      const behavior = FAULT_BEHAVIORS[fault]
      return caseForFault({ fault, expectedSafeState: behavior.safeState, expectedReason: behavior.reason, declaredBy: scheduled.has(fault) ? 'FAULT_NAMES_AND_FAULT_MATRIX' : 'FAULT_NAMES_UNSCHEDULED_MATRIX_CASE' })
    }),
    ...POLICY_CASES.map(caseForFault),
  ]
}

export function evaluateSimulation({ families = ['normal.v1', 'obstructed.v1', 'capacity.v1', 'correctable.v1'], seeds = [101, 202, 303, 404], durationSeconds = 30 } = {}) {
  const groups = []
  const cases = []
  for (const family of families) {
    for (const seed of seeds) {
      const runId = `eval-${family}-${seed}`
      const blocks = independentPulseBlocks({ family, runId, seed, count: 4 })
      const authority = authorityFromPulseBlocks(blocks)
      const comparators = COMPARATORS.map(method => evaluateComparator({ family, seed, method, blocks, durationSeconds }))
      const identified = comparators.find(comparator => comparator.method === 'identified')
      const pathClear = comparators.find(comparator => comparator.method === 'path-clear')
      const baseManifest = configurationForFamily(family.replace('.v1', ''), seed)
      const clearManifest = pathClearManifest(family, seed)
      const matchedInitialConditions = {
        initialTemperaturesC: baseManifest.air.initialTemperaturesC,
        loads: baseManifest.air.loads,
        source: baseManifest.source,
        durationSeconds,
      }
      const pathClearInitialConditions = {
        initialTemperaturesC: clearManifest.air.initialTemperaturesC,
        loads: clearManifest.air.loads,
        source: clearManifest.source,
        durationSeconds,
      }
      const matchedPathClearEvidence = family === 'obstructed.v1' ? {
        matchedInitialConditions: hashCanonical(matchedInitialConditions) === hashCanonical(pathClearInitialConditions),
        initialConditionsHash: hashCanonical(matchedInitialConditions),
        pathClearInitialConditionsHash: hashCanonical(pathClearInitialConditions),
        changedField: 'air.actuatorConductance[0]',
        authorityChanged: hashCanonical(baseManifest.air.actuatorConductance) !== hashCanonical(clearManifest.air.actuatorConductance),
        baseAuthorityHash: hashCanonical(baseManifest.air.actuatorConductance),
        pathClearAuthorityHash: hashCanonical(clearManifest.air.actuatorConductance),
        baseManifestHash: baseManifest.manifestHash,
        pathClearManifestHash: clearManifest.manifestHash,
        assumptions: clearManifest.assumptions,
      } : null
      const boundedInterventionObserved = Boolean(identified)
      const noExcursion = identified?.constraints.reachabilityOutcome === 'NO_EXCURSION'
      const initialExcursion = Boolean(identified?.constraints.initialTargetZones?.length)
      const robustReachabilityFailed = Boolean(identified && identified.constraints.reachable === false)
      const matchedPathClearImproved = Boolean(family === 'obstructed.v1' && matchedPathClearEvidence?.matchedInitialConditions && matchedPathClearEvidence.authorityChanged && identified && pathClear && robustReachabilityFailed && pathClear.constraints.reachable === true && finalHotTemperature(pathClear) < finalHotTemperature(identified))
      const authoritySufficient = authority.cooling.some(row => row.reduce((sum, value) => sum + Math.max(0, value) * 0.8, 0) > authority.uncertainty)
      const label = classifySyntheticLabel({ family, runId, seed, evidence: { boundedInterventionObserved, noExcursion, initialExcursion, boundedInterventionPassed: Boolean(identified?.constraints.passed), robustReachabilityFailed, matchedPathClearImproved, authoritySufficient } })
      groups.push({
        groupId: `${family}:${runId}:${seed}`,
        family,
        runId,
        seed,
        pulseBlocks: blocks.map(block => ({ id: block.independentBlockId, startSecond: block.startSecond, endSecond: block.endSecond, pulse: block.pulse, excitedActuator: block.excitedActuator, stableWindow: block.stableWindow, noFutureLeakage: block.noFutureLeakage, frozenFeatures: block.frozenFeatures, canonicalSimulator: block.canonicalSimulator })),
        frozenFeatures: blocks[0].frozenFeatures,
        canonicalSimulator: { source: 'VERSIONED_PLANT_VIRTUAL_DEVICE', simulatorVersion: 'cf-sim-v1', manifestHashes: [...new Set(blocks.map(block => block.canonicalSimulator.manifestHash))], outputHashes: blocks.flatMap(block => [...block.canonicalSimulator.baselineOutputHashes, ...block.canonicalSimulator.interventionOutputHashes]) },
        authority,
        comparators,
        outcome: identified?.constraints.reachabilityOutcome ?? 'UNAVAILABLE',
        action: noExcursion ? 'NO_ACTION' : identified?.constraints.reachabilityOutcome === 'CORRECTED' ? 'CORRECT' : 'ABSTAIN',
        interventionEvidence: { boundedInterventionObserved, noExcursion, initialExcursion, robustReachabilityFailed, matchedPathClearImproved, authoritySufficient, identifiedFinalHotC: identified ? finalHotTemperature(identified) : null, pathClearFinalHotC: pathClear ? finalHotTemperature(pathClear) : null },
        matchedPathClearEvidence,
        label,
      })
      for (const comparator of comparators) cases.push({ groupId: `${family}:${runId}:${seed}`, method: comparator.method, family, seed, metrics: comparator.metrics, constraints: comparator.constraints, ood: comparator.ood, abstention: comparator.abstention, canonicalSimulator: comparator.canonicalSimulator })
    }
  }
  const faultCases = declaredFaultCases()
  const oodCases = groups.flatMap(group => {
    const inDistribution = group.pulseBlocks.length > 0 ? group.authority.cooling.flat().every(Number.isFinite) : false
    const normal = detectOOD({ meanTemperatureC: 7, spreadC: 1, supplyC: 3.5, maxSlopeCPerSecond: 0.01 })
    const out = detectOOD({ meanTemperatureC: 22, spreadC: 18, supplyC: 12, maxSlopeCPerSecond: 1 })
    return [{ groupId: group.groupId, kind: 'IN_DISTRIBUTION', detected: !inDistribution, ...normal }, { groupId: group.groupId, kind: 'OUT_OF_DISTRIBUTION', detected: out.isOOD, ...out }]
  })
  const restackLabels = groups.filter(group => group.label.label === 'RESTACK_REQUIRED')
  const failedCases = cases.filter(item => !item.constraints.passed || item.ood.isOOD)
  const inconclusiveCases = cases.filter(item => item.abstention.decision === 'ABSTAIN')
  const resolvedFaults = faultCases.filter(item => item.status === 'PASSED')
  const inconclusiveFaults = faultCases.filter(item => item.inconclusive)
  const failedFaults = faultCases.filter(item => item.status === 'FAILED')
  return {
    schema: EVALUATION_SCHEMA,
    schemaVersion: '1.0',
    generatedAt: '2026-01-01T00:00:00.000Z',
    provenance: { evidenceClass: 'SIMULATED', source: 'CANONICAL_VERSIONED_PLANT_VIRTUAL_DEVICE', simulatorVersion: 'cf-sim-v1', modelVersion: 'declared-synthetic-rules-v1', physicalHardwareAssembled: false, actuatorAuthority: false },
    protocol: { name: 'independent-pulse-grouped-baseline-v2', stableWindowSeconds: 5, frozenFeatures: true, futureLeakage: false, independentPulseBlocks: true, alternatingActuators: ['A', 'B'], durationSeconds, canonicalSimulatorPath: ['src/simulator/configuration.ts', 'src/simulator/plant.ts', 'src/simulator/faults.ts', 'src/simulator/virtual-device.ts'] },
    grouping: { unit: 'configuration-family/run/seed', split: 'grouped-holdout', groups: groups.map(group => group.groupId), trainGroups: [], holdoutGroups: groups.map(group => group.groupId), temporalLeakage: false, groupOverlap: false },
    configurationFamilies: [...new Set(groups.map(group => group.family))],
    seeds: [...seeds],
    comparators: COMPARATORS,
    groups,
    cases,
    faults: { total: faultCases.length, resolved: resolvedFaults.length, failed: failedFaults.length, inconclusive: inconclusiveFaults.length, coverage: Number((resolvedFaults.length / faultCases.length).toFixed(6)), declaredFaultNames: [...FAULT_NAMES], faultMatrixDeclaredNames: [...new Set(faultMatrixConfiguration.faults.map(event => event.name))], cases: faultCases },
    ood: { total: oodCases.length, detected: oodCases.filter(item => item.detected).length, falseAbstention: oodCases.filter(item => item.kind === 'IN_DISTRIBUTION' && item.detected).length, cases: oodCases },
    abstention: { totalCases: cases.length, abstained: inconclusiveCases.length, failed: failedCases.length, safeOutput: [0, 0], modelAdvisoryOnly: true, directActuatorWrite: false, shieldAuthoritative: true },
    labels: { counts: Object.fromEntries([...new Set(groups.map(group => group.label.label))].map(label => [label, groups.filter(group => group.label.label === label).length])), restackRequired: { count: restackLabels.length, evidenceClass: 'SIMULATED', syntheticOnly: true, physicalInferenceAllowed: false, requiresObservedBoundedFailureAndMatchedPathClear: true } },
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
  return { families: parseList(values.families, ['normal.v1', 'obstructed.v1', 'capacity.v1', 'correctable.v1']), seeds: parseList(values.seeds, ['101', '202', '303', '404']).map(Number), output: values.output ?? 'artifacts/simulation/evaluation.json' }
}
