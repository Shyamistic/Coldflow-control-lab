import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CONTEXTS, EVIDENCE_CLASSES, FIRMWARE_PROFILE, LABELS, OPERATING_STATES, SAFETY_REASONS, SIMULATION_COMPATIBILITY_VALUE, SIMULATION_PROFILE, TRANSITIONS, canonicalEvidence, publicEvidence, transition } from '../src/contracts.ts'

const root = resolve(import.meta.dirname, '..')
const loadJson = async (relativePath: string) => JSON.parse(await readFile(resolve(root, relativePath), 'utf8')) as Record<string, unknown>

test('versioned contract schemas and valid fixtures cover the shared boundary', async () => {
  const schemaNames = ['telemetry.v1.schema.json', 'sample-quality.v1.schema.json', 'control-envelope.v1.schema.json', 'provenance.v1.schema.json', 'label.v1.schema.json']
  for (const name of schemaNames) {
    const schema = await loadJson(`contracts/jsonschema/${name}`)
    assert.equal(schema.type, 'object')
    assert.equal((schema.properties as Record<string, unknown>).schemaVersion && typeof (schema.properties as Record<string, unknown>).schemaVersion, 'object')
  }
  const telemetry = await loadJson('contracts/fixtures/valid/telemetry.v1.json')
  assert.equal(telemetry.schemaVersion, '1.0')
  assert.equal(telemetry.evidenceClass, 'SIMULATED')
  assert.deepEqual((telemetry.temperaturesC as unknown[]).length, 8)
  assert.equal((telemetry.quality as Record<string, unknown>).uncertaintyU95C, 0.5)
  assert.deepEqual((await loadJson('contracts/fixtures/valid/label.v1.json')).label, 'ABSTAIN')
  assert.equal((await loadJson('contracts/fixtures/valid/control-envelope.v1.json')).authority, 'DETERMINISTIC_SAFETY_SHIELD')
})

test('evidence and public compatibility values remain explicit', () => {
  assert.deepEqual(EVIDENCE_CLASSES, ['SIMULATED', 'REPLAY', 'LIVE_TABLETOP', 'FIELD_DATA'])
  assert.equal(canonicalEvidence(SIMULATION_COMPATIBILITY_VALUE), 'SIMULATED')
  assert.equal(publicEvidence('SIMULATED'), SIMULATION_COMPATIBILITY_VALUE)
  assert.deepEqual(CONTEXTS, ['NORMAL', 'DOOR_OPEN', 'DEFROST', 'DRIP', 'FAN_DELAY', 'POST_EVENT_RECOVERY', 'SOURCE_UNKNOWN'])
  assert.equal(SIMULATION_PROFILE.maximumDuty, 0.8)
  assert.equal(FIRMWARE_PROFILE.maximumDuty, 0.4)
})

test('state machine enumerates every canonical state and rejects unsafe transitions to fallback', async () => {
  const stateFixture = await loadJson('contracts/fixtures/valid/operating-state.v1.json')
  assert.deepEqual(stateFixture.states, OPERATING_STATES)
  assert.equal(stateFixture.modelMayCommand, false)
  for (const state of OPERATING_STATES) assert.equal(typeof state, 'string')
  assert.equal(TRANSITIONS.length >= OPERATING_STATES.length, true)
  assert.deepEqual(transition('OBSERVE', 'IDENTIFY'), { state: 'IDENTIFYING', accepted: true, reason: 'TRANSITION_ACCEPTED' })
  assert.deepEqual(transition('AUTO_CORRECT', 'UNSAFE'), { state: 'ABSTAIN', accepted: true, reason: 'TRANSITION_ACCEPTED' })
  assert.deepEqual(transition('AUTO_CORRECT', 'RESET'), { state: 'SAFE_FALLBACK', accepted: false, reason: 'TRANSITION_REJECTED_SAFE_FALLBACK' })
  assert.deepEqual(transition('SAFE_FALLBACK', 'RESET'), { state: 'SAFE_BOOT', accepted: true, reason: 'TRANSITION_ACCEPTED' })
})

test('labels and safety vectors are closed, versioned, and model-advisory only', async () => {
  assert.deepEqual(LABELS, ['CORRECTABLE', 'RESTACK_REQUIRED', 'CAPACITY_OR_EQUIPMENT_FAULT', 'SENSOR_OR_EVENT_ARTIFACT', 'UNKNOWN', 'ABSTAIN'])
  const vectors = await loadJson('contracts/fixtures/safety-vectors.v1.json')
  assert.equal(vectors.schemaVersion, '1.0')
  const rows = vectors.vectors as Array<{ name: string; expectedReason: string; permitted: boolean }>
  assert.ok(rows.some(row => row.name === 'approved' && row.permitted))
  assert.ok(rows.filter(row => row.name !== 'approved').every(row => !row.permitted))
  assert.equal(SAFETY_REASONS.approved, 'APPROVED_BOUNDED')
  const generated = await readFile(resolve(root, 'firmware/include/generated/safety_vectors.hpp'), 'utf8')
  for (const row of rows) assert.match(generated, new RegExp(row.expectedReason))
  assert.match(generated, /maximumDuty = 0\.4f/)
})

test('invalid fixtures demonstrate unknown version, contradictory authority, and malformed fields', async () => {
  const unknown = await loadJson('contracts/fixtures/invalid/unknown-version.json')
  assert.notEqual(unknown.schemaVersion, '1.0')
  const contradictory = await loadJson('contracts/fixtures/invalid/contradictory-control.json')
  assert.equal(contradictory.authority, 'MODEL_DIRECT')
  assert.equal((contradictory.expiresAtMs as number) < (contradictory.issuedAtMs as number), true)
  const malformed = await loadJson('contracts/fixtures/invalid/malformed-safety.json')
  assert.equal((malformed.vectors as Array<Record<string, unknown>>)[0].unknown, true)
})
