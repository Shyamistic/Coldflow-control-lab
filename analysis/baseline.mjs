import { DEFAULT_LIMITS, evaluateTrajectoryConstraints, detectOOD, safeAbstention } from './constraints.mjs'
import { authorityFromPulseBlocks } from './control.mjs'

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

function trajectoryFor({ family, method, authority, durationSeconds = 30 }) {
  const initial = family === 'normal.v1' ? [6.5, 6.7, 6.8, 6.4, 6.6, 6.7] : [10.5, 8.9, 7.4, 6.6, 7.1, 8.5]
  const sourceC = family === 'capacity.v1' ? 9.4 : 3.5
  const trajectory = []
  const actions = []
  let temperatures = [...initial]
  for (let second = 0; second <= durationSeconds; second += 1) {
    const duty = dutyFor(method, temperatures, family, authority)
    actions.push({ second, duty: [...duty] })
    trajectory.push({ seconds: second, temperaturesC: temperatures.map(value => Number(value.toFixed(6))), supplyC: sourceC })
    if (second === durationSeconds) break
    const power = duty.reduce((sum, value) => sum + 8 * value ** 3, 0)
    temperatures = temperatures.map((value, zone) => {
      const gain = authority.cooling[zone]?.[0] * duty[0] + authority.cooling[zone]?.[1] * duty[1] || 0
      const obstruction = family === 'obstructed.v1' && zone === 0 ? 0.35 : 1
      return Math.max(-20, Math.min(50, value + (sourceC - value) * 0.0015 + 0.0008 - gain * obstruction * 0.012 + power / 240000))
    })
  }
  return { trajectory, actions }
}

function matrixMetrics(blocks, authority) {
  const responses = blocks.flatMap(block => block.baseline.at(-1).temperaturesC.map((value, zone) => value - block.intervention.at(-1).temperaturesC[zone]))
  const meanResponse = responses.reduce((sum, value) => sum + value, 0) / responses.length
  const variance = responses.reduce((sum, value) => sum + (value - meanResponse) ** 2, 0) / responses.length
  const signsPositive = authority.cooling.every(row => row.every(value => value >= 0))
  const rank = authority.cooling.some(row => row[0] > 0) && authority.cooling.some(row => row[1] > 0) ? 2 : 1
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
  const { trajectory, actions } = trajectoryFor({ family, method, authority, durationSeconds })
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
    trajectory,
    actions,
  }
}

export function evaluateComparatorSet({ family, seed, blocks, durationSeconds = 30 } = {}) {
  return COMPARATORS.map(method => evaluateComparator({ family, seed, method, blocks, durationSeconds }))
}
