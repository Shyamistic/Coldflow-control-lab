import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { canonicalJson, hashCanonical, RECORD_SCHEMA } from './manifest.mjs'

export const GENESIS_HASH = '0'.repeat(64)

async function existingRecords(path) {
  try {
    const text = await readFile(path, 'utf8')
    if (!text.trim()) return []
    return text.trimEnd().split('\n').map((line, index) => {
      try { return JSON.parse(line) } catch { throw new Error(`Invalid JSONL record at line ${index + 1}`) }
    })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

export function recordHash(record) {
  const { recordHash: _ignored, ...unsigned } = record
  return hashCanonical(unsigned)
}

export async function appendRecord(path, payload) {
  const records = await existingRecords(path)
  const previousHash = records.at(-1)?.recordHash ?? GENESIS_HASH
  if (records.length > 0 && records.some(record => recordHash(record) !== record.recordHash)) throw new Error('Cannot append to a modified simulation record file')
  const envelope = { ...payload, previousHash, recordHash: recordHash({ ...payload, previousHash }) }
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${canonicalJson(envelope)}\n`, { encoding: 'utf8' })
  return envelope
}

export async function readAndVerifyRun(path) {
  const records = await existingRecords(path)
  if (records.length === 0) throw new Error('Simulation record file is empty')
  let previousHash = GENESIS_HASH
  for (const [index, record] of records.entries()) {
    if (record.schema !== RECORD_SCHEMA) throw new Error(`Unsupported record schema at line ${index + 1}`)
    if (record.previousHash !== previousHash) throw new Error(`Record chain mismatch at line ${index + 1}`)
    if (recordHash(record) !== record.recordHash) throw new Error(`Record hash mismatch at line ${index + 1}`)
    previousHash = record.recordHash
  }
  if (records[0].type !== 'manifest') throw new Error('Simulation record must start with a manifest')
  return records
}
