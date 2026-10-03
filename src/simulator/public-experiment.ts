import { SIMULATION_COMPATIBILITY_VALUE } from '../contracts.ts'
import { canonicalHash, configurationForScenario } from './configuration.ts'
import { VirtualDevice } from './virtual-device.ts'
import type { ConfigurationManifest } from './configuration.ts'
import type { PlantState, Observation } from './plant.ts'
import type { Authority, Decision, Experiment, Method, Sample, Scenario, ZoneVector } from '../domain.ts'

export const SCENARIOS: Record<Scenario, { name: string; description: string }> = {
  partial: { name: 'Partial obstruction', description: 'A changing load diverts airflow from the back-left zone.' },
  blocked: { name: 'Full obstruction', description: 'The affected zone has almost no added-actuator authority.' },
  capacity: { name: 'Inadequate source', description: 'Supply air is too warm; redistribution cannot create cooling.' },
  sensor: { name: 'Stale sensor', description: 'A critical zone stops reporting; control must fall back.' },
  actuator: { name: 'Actuator fault', description: 'A fan command produces no valid actuator feedback.' },
  normal: { name: 'Balanced loading', description: 'No spatial excursion; extra airflow is unnecessary.' },
}

export interface CanonicalProvenance {
  evidenceClass: 'SIMULATED'
  executionClass: 'SIMULATED'
  simulatorVersion: 'cf-sim-v1'
  executionPath: 'VERSIONED_PLANT_VIRTUAL_DEVICE'
  configurationFamily: ConfigurationManifest['family']
  manifestHash: string
  configurationHash: string
  outputHash: string
  hardwareConnected: false
  directActuatorWrite: false
}

export type PublicExperiment = Experiment & {
  manifestHash: string
  configurationHash: string
  outputHash: string
  provenance: CanonicalProvenance
}

const protocol = 'cf-sim-v1; versioned configuration manifest; deterministic VirtualDevice ticks; synthetic coefficients; not physical evidence'
const dutyFor = (method: Method, decision: Decision, warm: boolean): [number, number] => {
  if (method === 'identified') return decision === 'AUTO_CORRECT' ? [0.4, 0.4] : [0, 0]
  if (method === 'fixed-high') return [0.8, 0.8]
  if (method === 'expert-rule') return warm ? [0.6, 0.6] : [0.2, 0.2]
  if (method === 'path-clear') return [0.4, 0.4]
  return [0.25, 0.25]
}

function authorityFor(manifest: ConfigurationManifest): Authority {
  const cooling = manifest.air.actuatorConductance.map(([first, second], index) => {
    const scale = Math.max(0, manifest.air.initialTemperaturesC[index] - manifest.source.temperatureC) * 120
    return [first * scale, second * scale]
  })
  return { cooling, uncertainty: 0.2, horizonSeconds: 120, sourceAtIdentification: manifest.source.temperatureC, configurationRevision: 1 }
}

function identifiedDecision(manifest: ConfigurationManifest, scenario: Scenario, temperatures: ZoneVector, authority: Authority): { state: Decision; reason: string } {
  const warm = temperatures.some(value => value > 8)
  if (!warm) return { state: 'OBSERVE', reason: 'NO_EXCURSION' }
  if (manifest.source.temperatureC >= 8) return { state: 'INVESTIGATE_EQUIPMENT', reason: 'SOURCE_INADEQUATE' }
  if (scenario === 'blocked' || authority.cooling[0].reduce((sum, gain) => sum + Math.max(0, gain) * 0.8, 0) <= authority.uncertainty) return { state: 'ABSTAIN', reason: 'INSUFFICIENT_AUTHORITY_INSPECT_PATH' }
  return { state: 'AUTO_CORRECT', reason: 'SIMULATED_AUTHORITY_SUPPORTED' }
}

function sampleFrom(state: PlantState, observation: Observation, fans: [number, number], decision: { state: Decision; reason: string }): Sample {
  return { seconds: observation.seconds, temperatures: [...observation.temperaturesC] as ZoneVector, supply: observation.supplyC, returnAir: observation.returnAirC, fans, fanWh: state.fanEnergyWh, hdt: state.hotDegreeMinutes, cdt: state.coldDegreeMinutes, spread: Math.max(...observation.temperaturesC) - Math.min(...observation.temperaturesC), state: decision.state, reason: decision.reason }
}

export function runCanonicalExperiment(scenario: Scenario, method: Method, duration = 600, seed = 2026): PublicExperiment {
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) throw new Error('Invalid duration')
  const manifest = configurationForScenario(scenario, seed)
  const authority = authorityFor(manifest)
  const device = new VirtualDevice(manifest)
  const samples: Sample[] = []
  for (let seconds = 0; seconds <= duration; seconds += 1) {
    const before = device.state
    const temperatures = [...before.airC] as ZoneVector
    const identified = identifiedDecision(manifest, scenario, temperatures, authority)
    const requested = dutyFor(method, identified.state, temperatures.some(value => value > 8))
    const result = device.tick({ nowMs: seconds * 1000, measuredAtMs: seconds * 1000, sequence: seconds + 1, requested, leaseUntilMs: seconds * 1000 + 60000 })
    const safetyDecision = result.accepted ? (method === 'identified' ? identified : { state: 'MANUAL_BOUNDED' as Decision, reason: 'SIMULATED_BASELINE' }) : { state: 'SAFE_FALLBACK' as Decision, reason: result.reason }
    if (seconds % 5 === 0 || seconds === duration) samples.push(sampleFrom(before, result.observation, result.applied, safetyDecision))
  }
  const initial = [...manifest.air.initialTemperaturesC] as ZoneVector
  const identity = { evidenceClass: SIMULATION_COMPATIBILITY_VALUE, scenario, method, samples, initial, authority, seed, protocol }
  const configurationHash = `fnv1a4:${canonicalHash(manifest)}`
  const outputHash = `fnv1a4:${canonicalHash(identity)}`
  const provenance: CanonicalProvenance = { evidenceClass: 'SIMULATED', executionClass: 'SIMULATED', simulatorVersion: 'cf-sim-v1', executionPath: 'VERSIONED_PLANT_VIRTUAL_DEVICE', configurationFamily: manifest.family, manifestHash: manifest.manifestHash, configurationHash, outputHash, hardwareConnected: false, directActuatorWrite: false }
  return { ...identity, manifestHash: manifest.manifestHash, configurationHash, outputHash, provenance }
}

export function exportCsv(experiment: PublicExperiment): string {
  const rows = ['evidence_class,scenario,method,seed,seconds,z1_c,z2_c,z3_c,z4_c,z5_c,z6_c,supply_c,return_c,fan_a,fan_b,fan_wh,hdt_k_min,cdt_k_min,spread_k,state,reason']
  for (const sample of experiment.samples) rows.push([SIMULATION_COMPATIBILITY_VALUE, experiment.scenario, experiment.method, experiment.seed, sample.seconds, ...sample.temperatures, sample.supply, sample.returnAir, ...sample.fans, sample.fanWh, sample.hdt, sample.cdt, sample.spread, sample.state, sample.reason].join(','))
  return rows.join('\n')
}
