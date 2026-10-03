import type { Scenario } from '../domain.ts'
import type { FaultEvent } from './faults.ts'
import { capacityConfiguration } from './configurations/capacity.ts'
import { correctableConfiguration } from './configurations/correctable.ts'
import { faultMatrixConfiguration } from './configurations/fault-matrix.ts'
import { normalConfiguration } from './configurations/normal.ts'
import { obstructedConfiguration } from './configurations/obstructed.ts'

export interface ConfigurationManifest {
  version: 'cf-sim-config-v1'
  family: 'normal' | 'obstructed' | 'capacity' | 'fault-matrix' | 'correctable'
  manifestHash: string
  seed: number
  assumptions: readonly string[]
  synthetic?: { evidenceClass: 'SIMULATED'; source: string; physicalHardwareAssembled: false; physicalGroundTruth: false }
  authority?: { comparator: 'ADVISORY_ONLY'; actuator: 'DISABLED'; safety: 'DETERMINISTIC_SHIELD_AUTHORITATIVE' }
  boundedCriteria?: { initialTargetZones: readonly number[]; upperLimitC: number; maxDuty: number; maxEnergyWh: number; maxDurationSeconds: number; condensationClearanceC: number }
  air: {
    initialTemperaturesC: readonly number[]
    supplyTemperatureC: number
    thermalMassC: readonly number[]
    mixingConductance: number
    actuatorConductance: readonly (readonly [number, number])[]
    loads: readonly number[]
  }
  source: { proven: boolean; temperatureC: number }
  door: { open: boolean; infiltrationLoad: number }
  defrost: { active: boolean; sourceTemperatureC: number }
  humidity: { relativeHumidity: number; moistureLoad: number }
  condensation: { wet: boolean; surfaceMinimumC: number; dewPointC: number; uncertaintyC: number }
  fans: { response: number; powerCoefficient: number }
  faults: readonly FaultEvent[]
}

export const CONFIGURATION_FAMILIES = {
  normal: normalConfiguration,
  obstructed: obstructedConfiguration,
  capacity: capacityConfiguration,
  correctable: correctableConfiguration,
  'fault-matrix': faultMatrixConfiguration,
} as const

export type ConfigurationFamily = keyof typeof CONFIGURATION_FAMILIES

export function canonicalHash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  let h3 = 0x85ebca6b
  let h4 = 0xc2b2ae35
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 0x01000193)
    h2 = Math.imul(h2 ^ code, 0x85ebca6b)
    h3 = Math.imul(h3 ^ code, 0xc2b2ae35)
    h4 = Math.imul(h4 ^ code, 0x27d4eb2d)
  }
  return [h1, h2, h3, h4].map(value => (value >>> 0).toString(16).padStart(8, '0')).join('')
}

function hashManifest(manifest: Omit<ConfigurationManifest, 'manifestHash'>): string {
  return canonicalHash(manifest)
}

export function manifestWithSeed(manifest: ConfigurationManifest, seed: number): ConfigurationManifest {
  if (!Number.isInteger(seed) || seed < 1) throw new Error('Invalid simulator seed')
  const copy = { ...manifest, seed }
  const { manifestHash: _ignored, ...withoutHash } = copy
  return { ...copy, manifestHash: `fnv1a4:${hashManifest(withoutHash)}` }
}

export function configurationForFamily(family: ConfigurationFamily, seed = CONFIGURATION_FAMILIES[family].seed): ConfigurationManifest {
  return manifestWithSeed(CONFIGURATION_FAMILIES[family], seed)
}

export function configurationForScenario(scenario: Scenario, seed = 2026): ConfigurationManifest {
  const family: ConfigurationFamily = scenario === 'normal' ? 'normal' : scenario === 'capacity' ? 'capacity' : scenario === 'correctable' ? 'correctable' : scenario === 'sensor' || scenario === 'actuator' ? 'fault-matrix' : 'obstructed'
  const manifest = configurationForFamily(family, seed)
  if (scenario === 'sensor') return manifestWithSeed({ ...manifest, faults: [{ name: 'SENSOR_STALE', startSeconds: 61, endSeconds: 3601, reason: 'STALE_CRITICAL_INPUT', safeState: 'SAFE_FALLBACK', safeOutput: 'STALE_OBSERVATION' }] }, seed)
  if (scenario === 'actuator') return manifestWithSeed({ ...manifest, faults: [{ name: 'ACTUATOR_NO_FEEDBACK', startSeconds: 0, endSeconds: 3601, reason: 'ACTUATOR_FEEDBACK_FAULT', safeState: 'SAFE_FALLBACK', safeOutput: 'ZERO_COMMAND' }] }, seed)
  return manifest
}
