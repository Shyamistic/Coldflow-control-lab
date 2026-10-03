import { createHash } from 'node:crypto'

export const RECORD_SCHEMA = 'coldflow.simulation-record.v1'
export const MANIFEST_SCHEMA = 'coldflow.simulation-manifest.v1'
export const CONTRACT_VERSION = '1.0'
export const SIMULATOR_VERSION = 'cf-sim-v1'
export const MODEL_VERSION = 'declared-synthetic-rules-v1'
export const EVIDENCE_CLASSES = ['SIMULATED', 'REPLAY', 'LIVE_TABLETOP', 'FIELD_DATA']
export const SYNTHETIC_FAMILIES = ['normal.v1', 'obstructed.v1', 'capacity.v1', 'fault-matrix.v1']

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export function hashCanonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function normalizeFamily(value = 'normal.v1') {
  const normalized = String(value).toLowerCase().replaceAll('_', '-')
  const family = normalized.endsWith('.v1') ? normalized : `${normalized}.v1`
  if (!SYNTHETIC_FAMILIES.includes(family)) throw new Error(`Unsupported configuration family: ${value}`)
  return family
}

function configurationForFamily(family, seed) {
  const common = { seed, version: 'cf-sim-config-v1', integration: '1s-euler', zones: 6 }
  const configurations = {
    'normal.v1': { initialTemperaturesC: [6.5, 6.7, 6.8, 6.4, 6.6, 6.7], sourceTemperatureC: 3.5, faultProfile: 'NONE', declaredRule: 'NO_EXCURSION_ABSTAIN' },
    'obstructed.v1': { initialTemperaturesC: [10.5, 8.9, 7.4, 6.6, 7.1, 8.5], sourceTemperatureC: 3.5, faultProfile: 'AIRFLOW_OBSTRUCTION', declaredRule: 'OBSTRUCTION_RESTACK_OR_CORRECT' },
    'capacity.v1': { initialTemperaturesC: [10.5, 8.9, 7.4, 6.6, 7.1, 8.5], sourceTemperatureC: 9.4, faultProfile: 'INADEQUATE_SOURCE', declaredRule: 'SOURCE_CAPACITY_FAULT' },
    'fault-matrix.v1': { initialTemperaturesC: [10.5, 8.9, 7.4, 6.6, 7.1, 8.5], sourceTemperatureC: 3.5, faultProfile: 'SENSOR_ACTUATOR_EVENTS', declaredRule: 'SENSOR_OR_EVENT_ARTIFACT' },
  }
  return { ...common, ...configurations[family] }
}

export function createManifest({ family = 'normal.v1', seed = 2026, durationSeconds = 120 } = {}) {
  const canonicalFamily = normalizeFamily(family)
  if (!Number.isInteger(seed) || seed < 1) throw new Error('Invalid simulator seed')
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) throw new Error('Invalid simulation duration')
  const configuration = configurationForFamily(canonicalFamily, seed)
  const configHash = hashCanonical(configuration)
  const base = {
    schema: MANIFEST_SCHEMA,
    schemaVersion: CONTRACT_VERSION,
    runId: `sim-${canonicalFamily.replace('.v1', '')}-${seed}-${configHash.slice(0, 12)}`,
    family: canonicalFamily,
    seed,
    durationSeconds,
    configHash,
    simulatorVersion: SIMULATOR_VERSION,
    contractVersion: CONTRACT_VERSION,
    modelVersion: MODEL_VERSION,
    evidenceClass: 'SIMULATED',
    source: 'SIMULATOR',
    generatedAt: `2026-01-01T00:00:00.000Z`,
    bootId: `boot-${canonicalFamily.replace('.v1', '')}-${seed}`,
    labelRules: [
      'Only declared synthetic family rules may emit a non-abstaining label.',
      'Insufficient, stale, contradictory, or replayed-as-live evidence emits UNKNOWN/ABSTAIN.',
      'Synthetic labels are advisory and never grant actuator authority.',
    ],
    configuration,
  }
  return { ...base, manifestHash: hashCanonical(base) }
}

export function assertManifest(manifest) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || manifest.schemaVersion !== CONTRACT_VERSION) throw new Error('Invalid simulation manifest schema')
  if (!EVIDENCE_CLASSES.includes(manifest.evidenceClass) || manifest.evidenceClass !== 'SIMULATED' || manifest.source !== 'SIMULATOR') throw new Error('Simulation manifest evidence boundary is invalid')
  const { manifestHash, ...base } = manifest
  if (hashCanonical(base) !== manifestHash) throw new Error('Manifest hash mismatch')
  if (hashCanonical(manifest.configuration) !== manifest.configHash) throw new Error('Configuration hash mismatch')
  normalizeFamily(manifest.family)
  return manifest
}
