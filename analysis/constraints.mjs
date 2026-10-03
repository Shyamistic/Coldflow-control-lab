export const CONSTRAINT_SCHEMA = 'coldflow.control-constraints.v1'
export const DEFAULT_LIMITS = Object.freeze({ lowC: 4, highC: 8, maxDuty: 0.8, maxEnergyWh: 4, maxStepC: 0.25, maxAgeMs: 200, leaseMs: 60000 })

function finiteTrajectory(trajectory) {
  return Array.isArray(trajectory) && trajectory.length > 0 && trajectory.every(sample => Array.isArray(sample.temperaturesC) && sample.temperaturesC.length === 6 && sample.temperaturesC.every(Number.isFinite))
}

export function evaluateTrajectoryConstraints({ trajectory, actions = [], limits = DEFAULT_LIMITS, sourceC = 3.5, condensation = { wet: false, surfaceMinimumC: 4, dewPointC: 0, uncertaintyC: 0.5 }, timing = { maxAgeMs: 0, leaseMs: 60000 } } = {}) {
  const reasons = []
  const valid = finiteTrajectory(trajectory)
  if (!valid) reasons.push('INVALID_TRAJECTORY')
  const samples = valid ? trajectory : []
  const trajectoryWithinStep = valid && samples.every((sample, index) => index === 0 || sample.temperaturesC.every((value, zone) => Math.abs(value - samples[index - 1].temperaturesC[zone]) <= limits.maxStepC))
  if (!trajectoryWithinStep) reasons.push('TRAJECTORY_STEP')
  const duties = actions.flatMap(action => Array.isArray(action) ? action : action?.duty ?? [])
  const dutyWithinBounds = duties.every(value => Number.isFinite(value) && value >= 0 && value <= limits.maxDuty)
  if (!dutyWithinBounds) reasons.push('DUTY_BOUNDS')
  const energyWh = duties.reduce((sum, value) => sum + 8 * value ** 3 / 3600, 0)
  const energyWithinBounds = energyWh <= limits.maxEnergyWh
  if (!energyWithinBounds) reasons.push('ENERGY_BOUNDS')
  const condensationSafe = !condensation.wet && Number.isFinite(condensation.surfaceMinimumC) && Number.isFinite(condensation.dewPointC) && condensation.surfaceMinimumC - condensation.dewPointC >= Math.max(2, condensation.uncertaintyC ?? 0)
  if (!condensationSafe) reasons.push('CONDENSATION_UNSAFE')
  const timingValid = timing.maxAgeMs <= limits.maxAgeMs && timing.leaseMs > 0 && timing.leaseMs <= limits.leaseMs
  if (!timingValid) reasons.push('TIMING_OR_EXPIRY')
  const initialTargetZones = valid ? samples.at(0).temperaturesC.map((value, zone) => value > limits.highC ? zone : null).filter(zone => zone !== null) : []
  const temperatureWithinBounds = valid && samples.every((sample, sampleIndex) => sample.temperaturesC.every((value, zone) => {
    const declaredInitialExcursion = sampleIndex === 0 && initialTargetZones.includes(zone) && value > limits.highC
    return declaredInitialExcursion || (value >= limits.lowC && value <= limits.highC)
  }))
  if (!temperatureWithinBounds) reasons.push('TEMPERATURE_BOUNDS')
  const finalTemperatures = valid ? samples.at(-1).temperaturesC : []
  const reachable = valid && sourceC < limits.highC && (initialTargetZones.length === 0 || initialTargetZones.every(zone => finalTemperatures[zone] < samples.at(0).temperaturesC[zone]))
  const reached = initialTargetZones.length === 0 || (reachable && initialTargetZones.every(zone => finalTemperatures[zone] <= limits.highC))
  const reachabilityOutcome = initialTargetZones.length === 0 ? 'NO_EXCURSION' : reached ? 'CORRECTED' : 'UNREACHABLE'
  if (reachabilityOutcome === 'UNREACHABLE') reasons.push('UNREACHABLE_TARGET')
  return {
    schema: CONSTRAINT_SCHEMA,
    passed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    temperatureWithinBounds,
    initialTargetZones,
    targetZones: initialTargetZones,
    reachabilityOutcome,
    outcome: reachabilityOutcome,
    trajectoryWithinStep,
    dutyWithinBounds,
    energyWithinBounds,
    energyWh: Number(energyWh.toFixed(6)),
    condensationSafe,
    timingValid,
    reachable,
    sourceC,
  }
}

export function detectOOD(features, envelope = { meanTemperatureC: [-5, 15], spreadC: [0, 12], supplyC: [2, 8], maxSlopeCPerSecond: 0.25 }) {
  const reasons = []
  const check = (value, bounds, name) => {
    if (!Number.isFinite(value) || value < bounds[0] || value > bounds[1]) reasons.push(name)
  }
  check(features?.meanTemperatureC, envelope.meanTemperatureC, 'MEAN_TEMPERATURE_OUT_OF_ENVELOPE')
  check(features?.spreadC, envelope.spreadC, 'SPREAD_OUT_OF_ENVELOPE')
  check(features?.supplyC, envelope.supplyC, 'SOURCE_OUT_OF_ENVELOPE')
  if (!Number.isFinite(features?.maxSlopeCPerSecond) || features.maxSlopeCPerSecond > envelope.maxSlopeCPerSecond) reasons.push('SLOPE_OUT_OF_ENVELOPE')
  if (features?.futureSamplesUsed) reasons.push('FUTURE_FEATURE_LEAKAGE')
  return { schema: 'coldflow.ood.v1', isOOD: reasons.length > 0, reasons: [...new Set(reasons)], confidence: reasons.length > 0 ? 0 : 0.8 }
}

export function safeAbstention({ ood = { isOOD: false }, constraints = { passed: true }, fault = null, reason = null } = {}) {
  const noAction = constraints.passed && constraints.reachabilityOutcome === 'NO_EXCURSION' && !ood.isOOD && !fault && !reason
  if (noAction) return { decision: 'NO_ACTION', reason: 'ALREADY_IN_TARGET', reasons: [], safeOutput: [0, 0], modelAdvisoryOnly: true, directActuatorWrite: false, shieldAuthoritative: true }
  const reasons = [
    ...(ood.isOOD ? ['OOD_INPUT'] : []),
    ...(constraints.passed ? [] : constraints.reasons ?? ['CONSTRAINT_FAILURE']),
    ...(fault ? [`FAULT_${fault}`] : []),
    ...(reason ? [reason] : []),
  ]
  const abstain = reasons.length > 0
  return { decision: abstain ? 'ABSTAIN' : 'ADVISORY', reason: abstain ? reasons[0] : 'WITHIN_VALIDATED_SYNTHETIC_ENVELOPE', reasons, safeOutput: [0, 0], modelAdvisoryOnly: true, directActuatorWrite: false, shieldAuthoritative: true }
}
