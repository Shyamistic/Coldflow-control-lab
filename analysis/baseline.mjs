import { DEFAULT_LIMITS, evaluateTrajectoryConstraints, detectOOD, safeAbstention } from './constraints.mjs'
import { authorityFromPulseBlocks, canonicalTrajectory } from './control.mjs'

export const COMPARATORS = ['fixed-normal', 'fixed-high', 'expert-rule', 'identified', 'path-clear']

function dutyFor(method, temperatures, family, authority) {
  const warm = temperatures.some(value => value > DEFAULT_LIMITS.highC)
  if (method === 'fixed-high') return [0.8, 0.8]
  if (method === 'fixed-normal') return [0.25, 0.25]
  if (method === 'expert-rule') return warm ? [0.6, 0.6] : [0.2, 0.2]
  if (method === 'path-clear') return family === 'obstructed.v1' ? [0.6, 0.6] : [0.25, 0.25]
  if (!warm) return [0, 0]
  const highest = temperatures.reduce((best, value, index) => value > temperatures[best] ? index : best, 0)
  const gain = authority.cooling[highest]?.reduce((sum, value) => sum + Math.max(0, value), 0) ?? 0
  return gain > authority.uncertainty ? [0.4, 0.4] : [0, 0]
}

function matrixMetrics(blocks, authority) {
  const responses = blocks.flatMap(block => block.baseline.at(-1).temperaturesC.map((value, zone) => value - block.intervention.at(-1).temperaturesC[zone]))
  const meanResponse = responses.reduce((sum, value) => sum + value, 0) / responses.length
  const variance = responses.reduce((sum, value) => sum + (value - meanResponse) ** 2, 0) / responses.length
  const signsPositive = authority.cooling.every(row => row.every(value => value >= 0))
  const rank = authority.cooling.some(row => row[0] !== 0) && authority.cooling.some(row => row[1] !== 0) ? 2 : 1
  const a = authority.cooling[0]
  const b = authority.cooling[1]
  const determinant = Math.abs(a[0] * b[1] - a[1] * b[0])
  const norm = Math.max(...authority.cooling.flat().map(value => Math.abs(value)), 0.000001)
  return {
    gainKPerDuty: authority.cooling,
    delaySeconds: blocks.reduce((sum, block) => sum + (block.endSecond - block.startSecond), 0) / blocks.length,
    signConsistent: signsPositive,
    rank,
    conditioning: Number((norm / Math.max(determinant, 0.000001)).toFixed(6)),
    uncertaintyK: Number((0.2 + Math.sqrt(variance)).toFixed(6)),
    confidence: Number(Math.max(0, Math.min(1, 1 - (0.2 + Math.sqrt(variance)))).toFixed(6)),
    meanResponseK: Number(meanResponse.toFixed(6)),
  }
}

export function evaluateComparator({ family, seed, method, blocks, durationSeconds = 30, fault = null } = {}) {
  if (!COMPARATORS.includes(method)) throw new Error(`Unsupported comparator: ${method}`)
  const authority = authorityFromPulseBlocks(blocks)
  const simulated = canonicalTrajectory({ family, seed, method, authority, durationSeconds, dutyFor })
  const { trajectory, actions } = simulated
  const final = trajectory.at(-1)
  const features = blocks[0].frozenFeatures
  const ood = detectOOD(features)
  const constraints = evaluateTrajectoryConstraints({ trajectory, actions, sourceC: final.supplyC, condensation: fault === 'CONDENSATION_RISK' ? { wet: true, surfaceMinimumC: 3, dewPointC: 2, uncertaintyC: 0.5 } : undefined, timing: fault ? { maxAgeMs: 250, leaseMs: 0 } : undefined })
  const abstention = safeAbstention({ ood, constraints, fault })
  const matrix = matrixMetrics(blocks, authority)
  const faultSafe = fault === null
  return {
    method,
    family,
    seed,
    evidenceClass: 'SIMULATED',
    metrics: {
      ...matrix,
      trajectoryWithinBounds: constraints.temperatureWithinBounds,
      reachability: constraints.reachable,
      reachabilityOutcome: constraints.reachabilityOutcome,
      noAction: constraints.reachabilityOutcome === 'NO_EXCURSION',
      corrected: constraints.reachabilityOutcome === 'CORRECTED',
      energyWh: constraints.energyWh,
      energyWithinBounds: constraints.energyWithinBounds,
      condensationSafe: constraints.condensationSafe,
      timingValid: constraints.timingValid,
      expiryValid: constraints.timingValid,
      ood: ood.isOOD,
      uncertaintyK: matrix.uncertaintyK,
      confidence: ood.isOOD ? 0 : matrix.confidence,
      abstained: abstention.decision === 'ABSTAIN' || !faultSafe,
      faultCovered: faultSafe,
    },
    constraints,
    ood,
    abstention: faultSafe ? abstention : safeAbstention({ fault }),
    advisoryOnly: true,
    directActuatorWrite: false,
    shieldAuthoritative: true,
    canonicalSimulator: { source: 'VERSIONED_PLANT_VIRTUAL_DEVICE', simulatorVersion: simulated.simulatorVersion, manifestHash: simulated.manifestHash, outputHashes: simulated.outputHashes },
    trajectory,
    actions,
  }
}

export function evaluateComparatorSet({ family, seed, blocks, durationSeconds = 30 } = {}) {
  return COMPARATORS.map(method => evaluateComparator({ family, seed, method, blocks, durationSeconds }))
}
