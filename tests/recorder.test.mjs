import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManifest } from '../recorder/manifest.mjs'
import { readAndVerifyRun } from '../recorder/append-only.mjs'
import { writeSimulationRun } from '../recorder/synthetic.mjs'

async function temporaryRun() {
  const directory = await mkdtemp(join(tmpdir(), 'coldflow-recorder-'))
  const path = join(directory, 'run.jsonl')
  await writeSimulationRun(path, createManifest({ family: 'normal.v1', seed: 2026, durationSeconds: 4 }))
  return { directory, path }
}

test('recorder creates deterministic, provenance-complete append-only records', async () => {
  const first = await temporaryRun()
  const second = await temporaryRun()
  try {
    assert.equal(await readFile(first.path, 'utf8'), await readFile(second.path, 'utf8'))
    const records = await readAndVerifyRun(first.path)
    assert.equal(records.length, 5)
    assert.equal(records[0].type, 'manifest')
    assert.equal(records[1].previousHash, records[0].recordHash)
    assert.equal(records[1].label.source, 'SYNTHETIC_RULE')
    assert.equal(records[1].label.evidenceClass, 'SIMULATED')
    for (const field of ['configurationFamily', 'runId', 'seed', 'reason', 'intervention', 'reviewer', 'custodian']) assert.ok(records[1].label[field])
    await assert.rejects(() => writeSimulationRun(first.path, createManifest({ durationSeconds: 4 })), /modified|exists|chain/i)
  } finally {
    await rm(first.directory, { recursive: true, force: true })
    await rm(second.directory, { recursive: true, force: true })
  }
})
