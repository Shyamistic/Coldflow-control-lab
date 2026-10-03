import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManifest } from '../recorder/manifest.mjs'
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
    await assert.rejects(() => replayRun(alteredManifest), /hash|chain|manifest/i)

    const sampleLines = (await readFile(run.path, 'utf8')).trim().split('\n')
    const sample = JSON.parse(sampleLines[1])
    sample.output.reason = 'ALTERED'
    sampleLines[1] = JSON.stringify(sample)
    const alteredSample = join(run.directory, 'altered-sample.jsonl')
    await writeFile(alteredSample, `${sampleLines.join('\n')}\n`)
    await assert.rejects(() => replayRun(alteredSample), /hash|chain|output/i)
  } finally {
    await rm(run.directory, { recursive: true, force: true })
  }
})
