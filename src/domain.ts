import { CONTEXTS, SIMULATION_COMPATIBILITY_VALUE } from './contracts.ts'
import type { CanonicalContext } from './contracts.ts'
import { advisoryForDecision } from './advisory.ts'
import type { Advisory } from './advisory.ts'
import { driverAccept, shield, validSafety, LIMITS } from './safety.ts'
import type { SafetyPair } from './safety.ts'
import { createLegacyPlant, stepLegacyPlant } from './simulator/plant.ts'

export type Context = CanonicalContext
export type Scenario = 'partial' | 'blocked' | 'capacity' | 'sensor' | 'actuator' | 'normal'
export type Method = 'fixed-normal' | 'fixed-high' | 'expert-rule' | 'identified' | 'path-clear'
export type Pair = SafetyPair
export type ZoneVector = [number, number, number, number, number, number]
export type Decision = 'OBSERVE' | 'IDENTIFYING' | 'AUTO_CORRECT' | 'ABSTAIN' | 'INVESTIGATE_EQUIPMENT' | 'SAFE_FALLBACK' | 'MANUAL_BOUNDED'
export { driverAccept, shield, validSafety, LIMITS }
export type { SafetyInput, Shielded } from './safety.ts'
export const LEGACY_COMPATIBILITY_NOTICE = 'COMPATIBILITY_ONLY: legacy domain facade is retained for unit coverage and migration; public evidence uses the versioned VirtualDevice adapter.'
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

export interface Action {
  fans: Pair
  state: Decision
  reason: string
  advisory: Advisory
}

function action(fans: Pair, state: Decision, reason: string): Action {
  return { fans, state, reason, advisory: advisoryForDecision(state, reason) }
}

export function chooseAction(temperatures: ZoneVector, authority: Authority, source: number, configurationRevision = 1): Action {
  if (authority.configurationRevision !== configurationRevision || Math.abs(source - authority.sourceAtIdentification) > 0.5) return action([0, 0], 'ABSTAIN', 'MODEL_OUT_OF_ENVELOPE')
  const warm = temperatures.map((value, index) => ({ value, index })).filter(zone => zone.value > LIMITS.high)
  if (!warm.length) return action([0, 0], 'OBSERVE', 'NO_EXCURSION')
  if (source >= LIMITS.high) return action([0, 0], 'INVESTIGATE_EQUIPMENT', 'SOURCE_INADEQUATE')
  if (warm.some(zone => authority.cooling[zone.index].reduce((sum, gain) => sum + Math.max(0, gain) * LIMITS.maximum, 0) <= authority.uncertainty)) return action([0, 0], 'ABSTAIN', 'INSUFFICIENT_AUTHORITY_INSPECT_PATH')
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
  if (!best.some(value => value > 0)) return action(best, 'ABSTAIN', 'NO_SAFE_BOUNDED_ACTION')
  return action(best, 'AUTO_CORRECT', 'SIMULATED_AUTHORITY_SUPPORTED')
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
  return { evidenceClass: SIMULATION_COMPATIBILITY_VALUE, scenario, method, samples, initial, authority, seed, protocol: `${LEGACY_COMPATIBILITY_NOTICE} cf-domain-v1; matched start; 1s Euler; 120s cloned pulse calibration; synthetic lease renewal; fixed assumptions; not independent physical evidence` }
}

export function exportCsv(experiment: Experiment): string {
  const rows = ['evidence_class,scenario,method,seed,seconds,z1_c,z2_c,z3_c,z4_c,z5_c,z6_c,supply_c,return_c,fan_a,fan_b,fan_wh,hdt_k_min,cdt_k_min,spread_k,state,reason']
  for (const sample of experiment.samples) rows.push([SIMULATION_COMPATIBILITY_VALUE, experiment.scenario, experiment.method, experiment.seed, sample.seconds, ...sample.temperatures, sample.supply, sample.returnAir, ...sample.fans, sample.fanWh, sample.hdt, sample.cdt, sample.spread, sample.state, sample.reason].join(','))
  return rows.join('\n')
}