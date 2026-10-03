import { readAndVerifyRun } from './append-only.mjs'
import { assertManifest, hashCanonical } from './manifest.mjs'
import { canonicalOutput, evidenceForResult } from './synthetic.mjs'
import { VirtualDevice } from '../src/simulator/virtual-device.ts'
import { classifySyntheticLabel } from '../analysis/labels.mjs'
import { createReport } from '../analysis/reports.mjs'

export async function replayRun(path) {
  const records = await readAndVerifyRun(path)
  const manifestRecord = records[0]
  const { type: _type, manifestSchema, previousHash: _previousHash, recordHash: _recordHash, ...manifestRecordData } = manifestRecord
  const manifest = { ...manifestRecordData, schema: manifestSchema }
  assertManifest(manifest)
  const samples = records.slice(1)
  if (samples.length !== manifest.durationSeconds) throw new Error('Simulation record count does not match manifest duration')
  const device = new VirtualDevice(manifest.configuration)
  let expectedSequence = 1
  for (const sample of samples) {
    if (sample.type !== 'sample' || sample.manifestHash !== manifest.manifestHash || sample.simulatorManifestHash !== manifest.simulatorManifestHash || sample.runId !== manifest.runId) throw new Error('Sample provenance does not match manifest')
    if (sample.sequence !== expectedSequence || sample.bootId !== manifest.bootId || sample.timeMs !== (expectedSequence - 1) * 1000) throw new Error('Sample sequence or boot identity is invalid')
    if (sample.inputHash !== hashCanonical(sample.input) || sample.outputHash !== hashCanonical(sample.output)) throw new Error(`Input/output hash mismatch at sequence ${sample.sequence}`)
    const regenerated = device.tick(sample.input)
    const regeneratedOutput = canonicalOutput(regenerated)
    if (hashCanonical(regeneratedOutput) !== sample.outputHash) throw new Error(`Canonical simulator output mismatch at sequence ${sample.sequence}`)
    const regeneratedLabel = classifySyntheticLabel({ family: manifest.family, runId: manifest.runId, seed: manifest.seed, evidence: evidenceForResult(manifest, regenerated, expectedSequence - 1) })
    if (hashCanonical(regeneratedLabel) !== hashCanonical(sample.label)) throw new Error(`Canonical label mismatch at sequence ${sample.sequence}`)
    expectedSequence += 1
  }
  const report = createReport(manifest, samples)
  return { manifest, samples, report, canonicalRunHash: report.runHash, reportHash: report.reportHash }
}
