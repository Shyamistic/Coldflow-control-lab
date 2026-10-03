import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManifest, hashCanonical } from '../recorder/manifest.mjs'
import { manifestWithSeed } from '../src/simulator/configuration.ts'
import { recordHash } from '../recorder/append-only.mjs'
import { writeSimulationRun } from '../recorder/synthetic.mjs'
import { replayRun } from '../recorder/replay.mjs'

async function createRun() {
  const directory = await mkdtemp(join(tmpdir(), 'coldflow-replay-'))
  const path = join(directory, 'run.jsonl')
  await writeSimulationRun(path, createManifest({ family: 'obstructed.v1', seed: 2026, durationSeconds: 4 }))
  return { directory, path }
}

test('replay reproduces canonical run and report hashes', async () => {
  const first = await createRun()
  const second = await createRun()
  try {
    const a = await replayRun(first.path)
    const b = await replayRun(second.path)
    assert.equal(a.canonicalRunHash, b.canonicalRunHash)
    assert.equal(a.reportHash, b.reportHash)
    assert.deepEqual(a.report, b.report)
    assert.match(a.report.integrity, /TRUSTED_ANCHOR/)
  } finally {
    await rm(first.directory, { recursive: true, force: true })
    await rm(second.directory, { recursive: true, force: true })
  }
})

test('replay fails closed when a manifest or sample is altered', async () => {
  const run = await createRun()
  try {
    const lines = (await readFile(run.path, 'utf8')).trim().split('\n')
    const manifest = JSON.parse(lines[0])
    manifest.seed = 7
    lines[0] = JSON.stringify(manifest)
    const alteredManifest = join(run.directory, 'altered-manifest.jsonl')
    await writeFile(alteredManifest, `${lines.join('\n')}\n`)
    await assert.rejects(() => replayRun(alteredManifest), /hash|chain|manifest|anchor/i)

    const sampleLines = (await readFile(run.path, 'utf8')).trim().split('\n')
    const sample = JSON.parse(sampleLines[1])
    sample.output.reason = 'ALTERED'
    sampleLines[1] = JSON.stringify(sample)
    const alteredSample = join(run.directory, 'altered-sample.jsonl')
    await writeFile(alteredSample, `${sampleLines.join('\n')}\n`)
    await assert.rejects(() => replayRun(alteredSample), /hash|chain|output|anchor/i)
  } finally {
    await rm(run.directory, { recursive: true, force: true })
  }
})

test('replay rejects a coordinated manifest/configuration rewrite at the retained anchor boundary', async () => {
  const run = await createRun()
  try {
    const trusted = await replayRun(run.path)
    const records = (await readFile(run.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const { schema: _recordSchema, manifestSchema, type: _type, previousHash: _previousHash, recordHash: _recordHash, manifestHash: _manifestHash, ...manifestFields } = records[0]
    const configuration = manifestWithSeed({
      ...manifestFields.configuration,
      assumptions: [...manifestFields.configuration.assumptions, 'COORDINATED_REWRITE_TEST'],
    }, manifestFields.seed)
    const rewrittenBase = {
      ...manifestFields,
      schema: manifestSchema,
      configuration,
      configHash: hashCanonical(configuration),
      simulatorManifestHash: configuration.manifestHash,
    }
    const { manifestHash: _ignored, ...unsignedManifest } = rewrittenBase
    const rewrittenManifest = { ...rewrittenBase, manifestHash: hashCanonical(unsignedManifest) }
    records[0] = { ...rewrittenManifest, schema: 'coldflow.simulation-record.v1', manifestSchema, type: 'manifest' }
    for (const sample of records.slice(1)) {
      sample.configHash = rewrittenManifest.configHash
      sample.simulatorManifestHash = rewrittenManifest.simulatorManifestHash
      sample.manifestHash = rewrittenManifest.manifestHash
    }
    let previousHash = '0'.repeat(64)
    for (const record of records) {
      record.previousHash = previousHash
      record.recordHash = recordHash(record)
      previousHash = record.recordHash
    }
    const coordinated = join(run.directory, 'coordinated-manifest-rewrite.jsonl')
    await writeFile(coordinated, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
    await assert.rejects(() => replayRun(coordinated, { trustedAnchor: trusted.anchor }), /trusted replay anchor does not match canonical manifest/i)
  } finally {
    await rm(run.directory, { recursive: true, force: true })
  }
})

test('replay rejects coordinated input and label rewrites when the trusted anchor is retained', async () => {
  const run = await createRun()
  try {
    const trusted = await replayRun(run.path)
    const records = (await readFile(run.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    records[1].input.requested = [0, 0]
    records[1].inputHash = hashCanonical(records[1].input)
    records[1].label.reason = 'COORDINATED_REWRITE'
    let previousHash = '0'.repeat(64)
    for (const record of records) {
      record.previousHash = previousHash
      record.recordHash = recordHash(record)
      previousHash = record.recordHash
    }
    const coordinated = join(run.directory, 'coordinated-rewrite.jsonl')
    await writeFile(coordinated, `${records.map(record => JSON.stringify(record)).join('\n')}\n`)
    await assert.rejects(() => replayRun(coordinated, { trustedAnchor: trusted.anchor }), /input schedule|canonical label|anchor|hash/i)
  } finally {
    await rm(run.directory, { recursive: true, force: true })
  }
})
