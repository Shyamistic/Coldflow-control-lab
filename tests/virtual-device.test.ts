import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIRMWARE_PROFILE, SIMULATION_PROFILE } from '../src/contracts.ts'
import { VirtualDevice } from '../src/simulator/virtual-device.ts'

test('virtual device accepts bounded expiring abstract requests and rejects replay or expiry', () => {
  const device = new VirtualDevice('normal')
  const first = device.submit({ nowMs: 1000, sequence: 1, requested: [0.8, 0.8], leaseUntilMs: 60000 })
  assert.equal(first.accepted, true)
  assert.deepEqual(first.applied, [0.1, 0.1])
  const replay = device.submit({ nowMs: 1100, sequence: 1, requested: [0.8, 0.8], leaseUntilMs: 60000 })
  assert.equal(replay.accepted, false)
  assert.equal(replay.reason, 'REPLAY_OR_INVALID_SEQUENCE')
  const expired = device.submit({ nowMs: 61000, measuredAtMs: 61000, sequence: 2, requested: [0.2, 0.2], leaseUntilMs: 61000 })
  assert.equal(expired.accepted, false)
  assert.equal(expired.reason, 'LEASE_INVALID_OR_EXPIRED')
})

test('virtual device uses an explicit simulation-only safety profile boundary', () => {
  const device = new VirtualDevice('normal')
  const accepted = device.submit({ nowMs: 1000, sequence: 1, requested: [SIMULATION_PROFILE.maximumDuty, SIMULATION_PROFILE.maximumDuty], leaseUntilMs: 60000 })
  assert.deepEqual(accepted.applied, [SIMULATION_PROFILE.slewDuty, SIMULATION_PROFILE.slewDuty])
  assert.equal(SIMULATION_PROFILE.maximumDuty, 0.8)
  assert.equal(SIMULATION_PROFILE.slewDuty, 0.1)
  assert.equal(FIRMWARE_PROFILE.maximumDuty, 0.4)
  assert.equal(FIRMWARE_PROFILE.slewDuty, 0.05)
  assert.equal(FIRMWARE_PROFILE.leaseMs, 30000)
  assert.notEqual(SIMULATION_PROFILE.maximumDuty, FIRMWARE_PROFILE.maximumDuty)
})
test('fault matrix maps network, sensor, actuator and condensation faults to safe outputs', () => {
  const device = new VirtualDevice('fault-matrix')
  let networkLoss = false
  let sensorFault = false
  let actuatorFault = false
  let condensationFault = false
  for (let second = 0; second < 240; second += 1) {
    const result = device.tick({ nowMs: second * 1000, sequence: second + 1, requested: [0.4, 0.4], leaseUntilMs: second * 1000 + 60000 })
    if (result.faults.networkLoss) { networkLoss = true; assert.deepEqual(result.applied, [0, 0]) }
    if (result.faults.sensorStale || result.faults.sensorDropout) { sensorFault = true; assert.equal(result.accepted, false) }
    if (result.faults.actuatorNoFeedback) { actuatorFault = true; assert.equal(result.actuator.feedbackHealthy, false) }
    if (result.faults.condensationRisk) { condensationFault = true; assert.deepEqual(result.applied, [0, 0]) }
  }
  assert.equal(networkLoss, true)
  assert.equal(sensorFault, true)
  assert.equal(actuatorFault, true)
  assert.equal(condensationFault, true)
})

test('virtual device exposes observations and no physical command interface', () => {
  const device = new VirtualDevice('normal')
  const result = device.tick({ nowMs: 0, sequence: 1, requested: [0.2, 0.2], leaseUntilMs: 60000 })
  assert.equal(result.observation.temperaturesC.length, 6)
  assert.equal('commandPhysical' in device, false)
  assert.equal('pwm' in device, false)
})
