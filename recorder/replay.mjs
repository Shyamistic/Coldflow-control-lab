import { readFile } from 'node:fs/promises'
import { readAndVerifyRun } from './append-only.mjs'
import { assertManifest, canonicalInputForSequence, hashCanonical } from './manifest.mjs'
import { canonicalOutput, evidenceForResult } from './synthetic.mjs'
import { assertTrustedAnchor } from './trust.mjs'
import { VirtualDevice } from '../src/simulator/virtual-device.ts'
import { classifySyntheticLabel } from '../analysis/labels.mjs'
import { createReport } from '../analysis/reports.mjs'

async function loadAnchor(path, anchorPath, trustedAnchor) {
  if (trustedAnchor) return trustedAnchor
  const resolved = anchorPath ?? `${path}.anchor.json`
  try {
    return JSON.parse(await readFile(resolved, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Trusted replay anchor required; retain an external anchor digest for release replay')
    throw error
  }
}

export async function replayRun(path, { trustedAnchor = null, anchorPath = null } = {}) {
  const records = await readAndVerifyRun(path)
  const manifestRecord = records[0]
  const { type: _type, manifestSchema, previousHash: _previousHash, recordHash: _recordHash, ...manifestRecordData } = manifestRecord
  const manifest = { ...manifestRecordData, schema: manifestSchema }
  const anchor = await loadAnchor(path, anchorPath, trustedAnchor)
  assertTrustedAnchor(anchor, manifest)
  assertManifest(manifest)
  const samples = records.slice(1)
  if (samples.length !== manifest.durationSeconds) throw new Error('Simulation record count does not match manifest duration')
  const device = new VirtualDevice(manifest.configuration)
  let expectedSequence = 1
  for (const sample of samples) {
    if (sample.type !== 'sample' || sample.manifestHash !== manifest.manifestHash || sample.simulatorManifestHash !== manifest.simulatorManifestHash || sample.runId !== manifest.runId) throw new Error('Sample provenance does not match manifest')
    if (sample.sequence !== expectedSequence || sample.bootId !== manifest.bootId || sample.timeMs !== (expectedSequence - 1) * 1000) throw new Error('Sample sequence or boot identity is invalid')
    const expectedInput = canonicalInputForSequence(manifest, expectedSequence)
    if (hashCanonical(sample.input) !== hashCanonical(expectedInput) || hashCanonical(sample.input) !== sample.inputHash) throw new Error(`Canonical input schedule mismatch at sequence ${sample.sequence}`)
    if (sample.outputHash !== hashCanonical(sample.output)) throw new Error(`Input/output hash mismatch at sequence ${sample.sequence}`)
    const regenerated = device.tick(expectedInput)
    const regeneratedOutput = canonicalOutput(regenerated)
    if (hashCanonical(regeneratedOutput) !== sample.outputHash) throw new Error(`Canonical simulator output mismatch at sequence ${sample.sequence}`)
    const regeneratedLabel = classifySyntheticLabel({ family: manifest.family, runId: manifest.runId, seed: manifest.seed, evidence: evidenceForResult(manifest, regenerated, expectedSequence - 1) })
    if (hashCanonical(regeneratedLabel) !== hashCanonical(sample.label)) throw new Error(`Canonical label mismatch at sequence ${sample.sequence}`)
    expectedSequence += 1
  }
  const report = createReport(manifest, samples, { anchorDigest: anchor.anchorDigest })
  return { manifest, anchor, samples, report, canonicalRunHash: report.runHash, reportHash: report.reportHash }
}
