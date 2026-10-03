import { CONTEXTS, SIMULATION_COMPATIBILITY_VALUE, SIMULATION_PROFILE } from './contracts.ts'
import type { CanonicalContext } from './contracts.ts'
import { createLegacyPlant, stepLegacyPlant } from './simulator/plant.ts'

export type Context = CanonicalContext
export type Scenario = 'partial' | 'blocked' | 'capacity' | 'sensor' | 'actuator' | 'normal'
export type Method = 'fixed-normal' | 'fixed-high' | 'expert-rule' | 'identified' | 'path-clear'
export type Pair = [number, number]
export type ZoneVector = [number, number, number, number, number, number]
export type Decision = 'OBSERVE' | 'IDENTIFYING' | 'AUTO_CORRECT' | 'ABSTAIN' | 'INVESTIGATE_EQUIPMENT' | 'SAFE_FALLBACK' | 'MANUAL_BOUNDED'
export const LIMITS = { low: SIMULATION_PROFILE.lowTemperatureC, high: SIMULATION_PROFILE.highTemperatureC, maximum: SIMULATION_PROFILE.maximumDuty, slew: SIMULATION_PROFILE.slewDuty, freshnessMs: SIMULATION_PROFILE.freshnessMs, leaseMs: SIMULATION_PROFILE.leaseMs, shieldMs: SIMULATION_PROFILE.shieldMs, horizonSeconds: SIMULATION_PROFILE.horizonSeconds } as const
export const CANONICAL_CONTEXTS = CONTEXTS
export const SCENARIOS: Record<Scenario, { name: string; description: string }> = {
  partial: { name: 'Partial obstruction', description: 'A changing load diverts airflow from the back-left zone.' },
  blocked: { name: 'Full obstruction', description: 'The affected zone has almost no added-actuator authority.' },
  capacity: { name: 'Inadequate source', description: 'Supply air is too warm; redistribution cannot create cooling.' },
  sensor: { name: 'Stale sensor', description: 'A critical zone stops reporting; control must fall back.' },
  actuator: { name: 'Actuator fault', description: 'A fan command produces no valid actuator feedback.' },
  normal: { name: 'Balanced loading', description: 'No spatial excursion; extra airflow is unnecessary.' },
}
export interface Plant {
  scenario: Scenario
  temperatures: ZoneVector
  supply: number
  returnAir: number
  seconds: number
  fanWh: number
  hotDegreeMinutes: number
  coldDegreeMinutes: number
  load: ZoneVector
  conductance: Pair[]
}
export interface SafetyInput {
  nowMs: number
  context: Context
  temperatures: number[]
  measuredAtMs: number
  operatorApproved: boolean
  leaseUntilMs: number
  interlockClosed: boolean
  actuatorHealthy: boolean
  sourceProven: boolean
  wet: boolean
  surfaceMinimum: number | null
  dewPoint: number | null
  combinedU95: number
  requested: Pair
  previous: Pair
  sequence: number
  lastSequence: number
}
export interface Shielded {
  fans: Pair
  sequence: number
  expiresAtMs: number
  reason: string
  permitted: boolean
}
export interface Authority {
  cooling: number[][]
  uncertainty: number
  horizonSeconds: number
  sourceAtIdentification: number
  configurationRevision: number
}
export interface Sample {
  seconds: number
  temperatures: ZoneVector
  supply: number
  returnAir: number
  fans: Pair
  fanWh: number
  hdt: number
  cdt: number
  spread: number
  state: Decision
  reason: string
}
export interface Experiment {
  evidenceClass: 'SIMULATION'
  scenario: Scenario
  method: Method
  samples: Sample[]
  initial: ZoneVector
  authority: Authority
  seed: number
  protocol: string
}

export function shield(input: SafetyInput): Shielded {
  let reason = 'APPROVED_BOUNDED'
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.measuredAtMs) || input.measuredAtMs > input.nowMs || input.nowMs - input.measuredAtMs > LIMITS.freshnessMs) reason = 'STALE_CRITICAL_INPUT'
  else if (input.temperatures.length !== 8 || !input.temperatures.every(value => Number.isFinite(value) && value > -30 && value < 60)) reason = 'INVALID_SENSOR'
  else if (!input.interlockClosed) reason = 'INTERLOCK_OPEN'
  else if (input.context !== 'NORMAL') reason = `CONTEXT_${input.context}`
  else if (!input.sourceProven) reason = 'SOURCE_UNPROVEN'
  else if (!input.actuatorHealthy) reason = 'ACTUATOR_FEEDBACK_FAULT'
  else if (!input.operatorApproved || !Number.isFinite(input.leaseUntilMs) || input.leaseUntilMs <= input.nowMs || input.leaseUntilMs - input.nowMs > LIMITS.leaseMs) reason = 'LEASE_INVALID_OR_EXPIRED'
  else if (!Number.isFinite(input.sequence) || !Number.isInteger(input.sequence) || input.sequence <= input.lastSequence) reason = 'REPLAY_OR_INVALID_SEQUENCE'
  else if (input.wet || input.surfaceMinimum === null || input.dewPoint === null || !Number.isFinite(input.surfaceMinimum) || !Number.isFinite(input.dewPoint) || !Number.isFinite(input.combinedU95) || input.combinedU95 < 0 || input.surfaceMinimum - input.dewPoint < Math.max(2, input.combinedU95)) reason = 'CONDENSATION_UNOBSERVABLE_OR_UNSAFE'
  else if (input.temperatures.slice(0, 6).some(value => value < LIMITS.low)) reason = 'LOW_TEMPERATURE_LIMIT'
  else if (![...input.requested, ...input.previous].every(value => Number.isFinite(value) && value >= 0 && value <= LIMITS.maximum)) reason = 'OUT_OF_RANGE'
  const permitted = reason === 'APPROVED_BOUNDED'
  const fans = permitted ? input.requested.map((value, index) => Math.min(value, input.previous[index] + LIMITS.slew)) as Pair : [0, 0] as Pair
  return { fans, sequence: input.sequence, expiresAtMs: input.nowMs + LIMITS.shieldMs, reason, permitted }
}

export function driverAccept(setpoint: Shielded, nowMs: number, lastSequence: number): Pair {
  if (!setpoint.permitted || !Number.isFinite(nowMs) || nowMs >= setpoint.expiresAtMs || nowMs < setpoint.expiresAtMs - LIMITS.shieldMs || !Number.isInteger(setpoint.sequence) || setpoint.sequence <= lastSequence || !setpoint.fans.every(value => Number.isFinite(value) && value >= 0 && value <= LIMITS.maximum)) return [0, 0]
  return [...setpoint.fans]
}

export function createPlant(scenario: Scenario, seed = 2026): Plant {
  return createLegacyPlant(scenario, seed)
}

export function stepPlant(plant: Plant, fans: Pair, seconds = 1): Plant {
  return stepLegacyPlant(plant, fans, seconds)
}

export function identifyAuthority(initial: Plant, configurationRevision = 1): Authority {
  const predict = (fans: Pair) => {
    let plant = structuredClone(initial)
    for (let seconds = 0; seconds < LIMITS.horizonSeconds; seconds++) plant = stepPlant(plant, fans)
    return plant.temperatures
  }
  const baseline = predict([0, 0])
  const first = predict([0.4, 0])
  const second = predict([0, 0.4])
  const cooling = baseline.map((value, index) => [(value - first[index]) / 0.4, (value - second[index]) / 0.4])
  return { cooling, uncertainty: 0.2, horizonSeconds: LIMITS.horizonSeconds, sourceAtIdentification: initial.supply, configurationRevision }
}

export function chooseAction(temperatures: ZoneVector, authority: Authority, source: number, configurationRevision = 1): { fans: Pair; state: Decision; reason: string } {
  if (authority.configurationRevision !== configurationRevision || Math.abs(source - authority.sourceAtIdentification) > 0.5) return { fans: [0, 0], state: 'ABSTAIN', reason: 'MODEL_OUT_OF_ENVELOPE' }
  const warm = temperatures.map((value, index) => ({ value, index })).filter(zone => zone.value > LIMITS.high)
  if (!warm.length) return { fans: [0, 0], state: 'OBSERVE', reason: 'NO_EXCURSION' }
  if (source >= LIMITS.high) return { fans: [0, 0], state: 'INVESTIGATE_EQUIPMENT', reason: 'SOURCE_INADEQUATE' }
  if (warm.some(zone => authority.cooling[zone.index].reduce((sum, gain) => sum + Math.max(0, gain) * LIMITS.maximum, 0) <= authority.uncertainty)) return { fans: [0, 0], state: 'ABSTAIN', reason: 'INSUFFICIENT_AUTHORITY_INSPECT_PATH' }
  let best: Pair = [0, 0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const first of [0, 0.2, 0.4, 0.6, 0.8]) {
    for (const second of [0, 0.2, 0.4, 0.6, 0.8]) {
      const predictions = temperatures.map((value, index) => value - authority.cooling[index][0] * first - authority.cooling[index][1] * second)
      if (predictions.some(value => value - authority.uncertainty < LIMITS.low)) continue
      const score = predictions.reduce((sum, value) => sum + Math.max(0, value + authority.uncertainty - LIMITS.high) ** 2, 0) + 0.08 * (first ** 3 + second ** 3)
      if (score < bestScore) { bestScore = score; best = [first, second] }
    }
  }
  if (!best.some(value => value > 0)) return { fans: best, state: 'ABSTAIN', reason: 'NO_SAFE_BOUNDED_ACTION' }
  return { fans: best, state: 'AUTO_CORRECT', reason: 'SIMULATED_AUTHORITY_SUPPORTED' }
}

export function validSafety(overrides: Partial<SafetyInput> = {}): SafetyInput {
  return { nowMs: 1000, context: 'NORMAL', temperatures: [10, 9, 7, 6, 7, 8.5, 3.5, 8], measuredAtMs: 1000, operatorApproved: true, leaseUntilMs: 61000, interlockClosed: true, actuatorHealthy: true, sourceProven: true, wet: false, surfaceMinimum: 4, dewPoint: 0, combinedU95: 0.5, requested: [0.4, 0.4], previous: [0, 0], sequence: 1, lastSequence: 0, ...overrides }
}

export function runExperiment(scenario: Scenario, method: Method, duration = 600, seed = 2026): Experiment {
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) throw new Error('Invalid duration')
  let plant = createPlant(scenario, seed)
  const initial = [...plant.temperatures] as ZoneVector
  if (method === 'path-clear' && (scenario === 'partial' || scenario === 'blocked')) {
    plant.conductance[0] = [0.005, 0.002]
    plant.load[0] = 0.002
  }
  const authority = identifyAuthority(plant)
  const samples: Sample[] = []
  let previous: Pair = [0, 0]
  for (let seconds = 0; seconds <= duration; seconds++) {
    const proposed = chooseAction(plant.temperatures, authority, plant.supply)
    const requested: Pair = method === 'identified' ? proposed.fans : method === 'fixed-high' ? [0.8, 0.8] : method === 'expert-rule' ? (Math.max(...plant.temperatures) > LIMITS.high ? [0.6, 0.6] : [0.2, 0.2]) : [0.25, 0.25]
    const nowMs = seconds * 1000
    const result = shield(validSafety({ nowMs, measuredAtMs: scenario === 'sensor' && seconds > 60 ? 60000 : nowMs, temperatures: [...plant.temperatures, plant.supply, plant.returnAir], leaseUntilMs: nowMs + 60000, requested, previous, actuatorHealthy: scenario !== 'actuator', sequence: seconds + 1, lastSequence: seconds }))
    const fans = driverAccept(result, nowMs, seconds)
    const state: Decision = !result.permitted ? 'SAFE_FALLBACK' : method === 'identified' ? proposed.state : 'MANUAL_BOUNDED'
    if (seconds % 5 === 0 || seconds === duration) samples.push({ seconds, temperatures: [...plant.temperatures], supply: plant.supply, returnAir: plant.returnAir, fans, fanWh: plant.fanWh, hdt: plant.hotDegreeMinutes, cdt: plant.coldDegreeMinutes, spread: Math.max(...plant.temperatures) - Math.min(...plant.temperatures), state, reason: result.permitted ? (method === 'identified' ? proposed.reason : 'SIMULATED_BASELINE') : result.reason })
    previous = fans
    if (seconds < duration) plant = stepPlant(plant, fans)
  }
  return { evidenceClass: SIMULATION_COMPATIBILITY_VALUE, scenario, method, samples, initial, authority, seed, protocol: 'cf-simulation-v1; matched start; 1s Euler; 120s cloned pulse calibration; synthetic lease renewal; fixed assumptions; not independent physical evidence' }
}

export function exportCsv(experiment: Experiment): string {
  const rows = ['evidence_class,scenario,method,seed,seconds,z1_c,z2_c,z3_c,z4_c,z5_c,z6_c,supply_c,return_c,fan_a,fan_b,fan_wh,hdt_k_min,cdt_k_min,spread_k,state,reason']
  for (const sample of experiment.samples) rows.push([SIMULATION_COMPATIBILITY_VALUE, experiment.scenario, experiment.method, experiment.seed, sample.seconds, ...sample.temperatures, sample.supply, sample.returnAir, ...sample.fans, sample.fanWh, sample.hdt, sample.cdt, sample.spread, sample.state, sample.reason].join(','))
  return rows.join('\n')
}