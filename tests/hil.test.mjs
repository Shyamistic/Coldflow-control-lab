import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { firmwareReason, runSafetyVector, VirtualDevice } from '../src/simulator/virtual-device.ts'
import { driverAccept } from '../src/domain.ts'

const root = resolve(import.meta.dirname, '..')
const fixture = JSON.parse(await readFile(resolve(root, 'contracts/fixtures/safety-vectors.v1.json'), 'utf8'))

test('virtual device matches every canonical firmware safety vector and never outputs on rejection', () => {
  for (const vector of fixture.vectors) {
    const result = runSafetyVector(vector.name)
    assert.equal(result.reason, vector.expectedReason, vector.name)
    assert.equal(result.permitted, vector.permitted, vector.name)
    if (!vector.permitted) assert.deepEqual(result.output, [0, 0], vector.name)
  }
})

test('virtual HIL covers stale/invalid inputs, lease, replay, interlock, condensation and low limit', () => {
  for (const name of ['stale', 'sensor', 'lease', 'replay', 'interlock', 'condensation', 'low-limit']) {
    const result = runSafetyVector(name)
    assert.equal(result.permitted, false, name)
    assert.deepEqual(result.output, [0, 0], name)
  }
})

test('virtual HIL expires actuator output, preserves sequence across reboot, wraps fail-closed and ignores network commands', () => {
  const device = new VirtualDevice({ commissioned: true })
  const approved = device.step({ sequence: 1 })
  assert.equal(approved.permitted, true)
  assert.deepEqual(driverAccept(approved, approved.expiresAtMs, 0), [0, 0])

  device.reboot()
  assert.deepEqual(device.currentOutput(), [0, 0])
  const replay = device.step({ sequence: 1 })
  assert.equal(replay.permitted, false)
  assert.deepEqual(replay.output, [0, 0])

  const wrapped = device.step({ sequence: 0xffffffff })
  assert.equal(wrapped.permitted, true)
  const afterWrap = device.step({ sequence: 0 })
  assert.equal(afterWrap.permitted, false)
  assert.deepEqual(afterWrap.output, [0, 0])

  const networkLoss = device.step({ sequence: 2, networkAvailable: false })
  assert.equal(firmwareReason(networkLoss), 'NETWORK_UNAVAILABLE_TELEMETRY_ONLY')
  assert.deepEqual(networkLoss.output, [0, 0])

  const uncommissioned = new VirtualDevice()
  const boot = uncommissioned.step()
  assert.equal(firmwareReason(boot, false), 'UNCOMMISSIONED_OUTPUT_DISABLED')
  assert.deepEqual(boot.output, [0, 0])
})
