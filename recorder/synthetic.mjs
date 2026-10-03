import { access } from 'node:fs/promises'
import { appendRecord } from './append-only.mjs'
import { createManifest, hashCanonical } from './manifest.mjs'
import { classifySyntheticLabel } from '../analysis/labels.mjs'
import { VirtualDevice } from '../src/simulator/virtual-device.ts'

export function canonicalOutput(result) {
  return {
    accepted: result.accepted,
    applied: result.applied,
    state: result.state,
    reason: result.reason,
    observation: result.observation,
    actuator: result.actuator,
    disturbance: result.disturbance,
    faults: result.faults,
  }
}

export function evidenceForResult(manifest, result, second) {
  return {
    corrected: manifest.family === 'obstructed.v1' && second >= 60 && result.accepted,
    authoritySufficient: result.accepted,
    stale: result.faults.sensorStale || result.faults.sensorDropout || result.faults.networkDelay,
    insufficient: manifest.family === 'capacity.v1' || !manifest.configuration.source.proven,
    contradictory: false,
  }
}

export function simulationRecords(manifest) {
  const records = []
  const device = new VirtualDevice(manifest.configuration)
  for (let second = 0; second < manifest.durationSeconds; second += 1) {
    const input = { requested: [0.4, 0.4], nowMs: second * 1000, leaseUntilMs: second * 1000 + 60000, sequence: second + 1 }
    const result = device.tick(input)
    const output = canonicalOutput(result)
    const evidence = evidenceForResult(manifest, result, second)
    const label = classifySyntheticLabel({ family: manifest.family, runId: manifest.runId, seed: manifest.seed, evidence })
    records.push({
      schema: 'coldflow.simulation-record.v1',
      type: 'sample',
      runId: manifest.runId,
      family: manifest.family,
      configHash: manifest.configHash,
      simulatorManifestHash: manifest.simulatorManifestHash,
      manifestHash: manifest.manifestHash,
      seed: manifest.seed,
      simulatorVersion: manifest.simulatorVersion,
      contractVersion: manifest.contractVersion,
      modelVersion: manifest.modelVersion,
      evidenceClass: manifest.evidenceClass,
      bootId: manifest.bootId,
      timeMs: second * 1000,
      capturedAt: new Date(Date.parse(manifest.generatedAt) + second * 1000).toISOString(),
      sequence: second + 1,
      input,
      output,
      inputHash: hashCanonical(input),
      outputHash: hashCanonical(output),
      label,
    })
  }
  return records
}

export async function writeSimulationRun(path, manifest = createManifest()) {
  try {
    await access(path)
    throw new Error('Refusing to overwrite simulation record file; output already exists')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await appendRecord(path, { ...manifest, schema: 'coldflow.simulation-record.v1', manifestSchema: manifest.schema, type: 'manifest' })
  for (const record of simulationRecords(manifest)) await appendRecord(path, record)
  return manifest
}
