import { access } from 'node:fs/promises'
import { appendRecord } from './append-only.mjs'
import { createManifest, hashCanonical } from './manifest.mjs'
import { classifySyntheticLabel } from '../analysis/labels.mjs'

function temperaturesFor(manifest, second) {
  const initial = manifest.configuration.initialTemperaturesC
  const drift = manifest.family === 'normal.v1' ? 0 : Math.min(second, 120) * 0.008
  return initial.map((value, index) => Number((value + drift + Math.sin((second + index + manifest.seed) / 17) * 0.002).toFixed(6)))
}

function sampleFor(manifest, second) {
  const temperaturesC = temperaturesFor(manifest, second)
  const isFault = manifest.family === 'fault-matrix.v1' && second >= 30
  const accepted = !isFault && manifest.family !== 'capacity.v1'
  const applied = accepted ? [0.1, 0.1] : [0, 0]
  const reason = isFault ? 'SENSOR_OR_EVENT_ARTIFACT' : manifest.family === 'capacity.v1' ? 'SOURCE_INADEQUATE' : 'APPROVED_BOUNDED'
  const output = {
    accepted,
    applied,
    state: accepted ? 'AUTO_CORRECT' : 'SAFE_FALLBACK',
    reason,
    observation: { seconds: second, measuredAtMs: isFault ? (second - 3) * 1000 : second * 1000, temperaturesC, supplyC: manifest.configuration.sourceTemperatureC, returnAirC: Number((temperaturesC.reduce((sum, value) => sum + value, 0) / temperaturesC.length).toFixed(6)) },
  }
  const evidence = {
    corrected: manifest.family === 'obstructed.v1' && second >= 60,
    authoritySufficient: manifest.family !== 'obstructed.v1' || second < 60,
    stale: isFault,
    insufficient: manifest.family === 'capacity.v1',
  }
  return { temperaturesC, output, evidence }
}

export function simulationRecords(manifest) {
  const records = []
  for (let second = 0; second < manifest.durationSeconds; second += 1) {
    const { output, evidence } = sampleFor(manifest, second)
    const input = { requested: [0.4, 0.4], nowMs: second * 1000, leaseUntilMs: second * 1000 + 60000, sequence: second + 1 }
    const label = classifySyntheticLabel({ family: manifest.family, runId: manifest.runId, seed: manifest.seed, evidence })
    records.push({
      schema: 'coldflow.simulation-record.v1',
      type: 'sample',
      runId: manifest.runId,
      family: manifest.family,
      configHash: manifest.configHash,
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
