import { createHash } from 'node:crypto'
import { configurationForFamily } from '../src/simulator/configuration.ts'

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

function canonicalFamilyForSimulator(family) {
  return family.replace('.v1', '')
}

function configurationForFamilyManifest(family, seed) {
  return configurationForFamily(canonicalFamilyForSimulator(family), seed)
}

export function createManifest({ family = 'normal.v1', seed = 2026, durationSeconds = 120 } = {}) {
  const canonicalFamily = normalizeFamily(family)
  if (!Number.isInteger(seed) || seed < 1) throw new Error('Invalid simulator seed')
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) throw new Error('Invalid simulation duration')
  const configuration = configurationForFamilyManifest(canonicalFamily, seed)
  const configHash = hashCanonical(configuration)
  const base = {
    schema: MANIFEST_SCHEMA,
    schemaVersion: CONTRACT_VERSION,
    runId: `sim-${canonicalFamily.replace('.v1', '')}-${seed}-${configHash.slice(0, 12)}`,
    family: canonicalFamily,
    seed,
    durationSeconds,
    configHash,
    simulatorManifestHash: configuration.manifestHash,
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
  const expectedConfiguration = configurationForFamilyManifest(manifest.family, manifest.seed)
  if (canonicalJson(expectedConfiguration) !== canonicalJson(manifest.configuration) || manifest.simulatorManifestHash !== expectedConfiguration.manifestHash) throw new Error('Canonical simulator manifest mismatch')
  normalizeFamily(manifest.family)
  return manifest
}
