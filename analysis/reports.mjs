import { assertLabel } from './labels.mjs'
import { hashCanonical } from '../recorder/manifest.mjs'

function unsignedRecord(record) {
  const { previousHash: _previous, recordHash: _recordHash, ...payload } = record
  return payload
}

export function canonicalRunHash(manifest, samples) {
  return hashCanonical({ manifestHash: manifest.manifestHash, samples: samples.map(unsignedRecord) })
}

export function createReport(manifest, samples) {
  const labels = samples.map(sample => {
    assertLabel(sample.label)
    return sample.label
  })
  const counts = Object.fromEntries([...new Set(labels.map(label => label.label))].sort().map(label => [label, labels.filter(candidate => candidate.label === label).length]))
  const body = {
    schema: 'coldflow.simulation-report.v1',
    schemaVersion: '1.0',
    runId: manifest.runId,
    family: manifest.family,
    seed: manifest.seed,
    manifestHash: manifest.manifestHash,
    evidenceClass: manifest.evidenceClass,
    source: 'RECORDER',
    simulatorVersion: manifest.simulatorVersion,
    contractVersion: manifest.contractVersion,
    modelVersion: manifest.modelVersion,
    recordCount: samples.length,
    runHash: canonicalRunHash(manifest, samples),
    labelCounts: counts,
    labels: labels.map(label => ({ label: label.label, reason: label.reason, evidenceClass: label.evidenceClass, source: label.source })),
    integrity: 'VERIFIED_APPEND_ONLY_CHAIN',
    generatedAt: manifest.generatedAt,
  }
  return { ...body, reportHash: hashCanonical(body) }
}
