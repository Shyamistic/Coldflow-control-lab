import { FIRMWARE_PROFILE } from '../contracts.ts'
import { driverAccept, shield, validSafety } from '../domain.ts'
import type { Pair, SafetyInput, Shielded } from '../domain.ts'

export interface VirtualDeviceStep extends Partial<SafetyInput> {
  commissioned?: boolean
  networkAvailable?: boolean
}

export interface VirtualDeviceResult extends Shielded {
  output: Pair
  telemetryOnly: true
  networkAvailable: boolean
}

const canonicalReasons: Record<string, string> = {
  APPROVED_BOUNDED: 'APPROVED_LOCAL_DIAGNOSTIC',
  INVALID_SENSOR: 'SENSOR_INVALID',
  CONTEXT_DOOR_OPEN: 'CONTEXT_OR_SOURCE_UNPROVEN',
  CONTEXT_DEFROST: 'CONTEXT_OR_SOURCE_UNPROVEN',
  CONTEXT_DRIP: 'CONTEXT_OR_SOURCE_UNPROVEN',
  CONTEXT_FAN_DELAY: 'CONTEXT_OR_SOURCE_UNPROVEN',
  CONTEXT_POST_EVENT_RECOVERY: 'CONTEXT_OR_SOURCE_UNPROVEN',
  CONTEXT_SOURCE_UNKNOWN: 'CONTEXT_OR_SOURCE_UNPROVEN',
  SOURCE_UNPROVEN: 'CONTEXT_OR_SOURCE_UNPROVEN',
  REPLAY_OR_INVALID_SEQUENCE: 'REPLAY_OR_SEQUENCE_EXHAUSTED',
}

export function firmwareReason(result: Shielded, commissioned = true): string {
  if (!commissioned) return 'UNCOMMISSIONED_OUTPUT_DISABLED'
  return canonicalReasons[result.reason] ?? result.reason
}

export class VirtualDevice {
  private lastSequence = 0
  private issuedSequence = 0
  private output: Pair = [0, 0]
  private commissioned: boolean

  constructor(options: { commissioned?: boolean } = {}) {
    this.commissioned = options.commissioned ?? false
  }

  reboot(): void {
    this.issuedSequence = this.lastSequence
    this.output = [0, 0]
  }

  step(overrides: VirtualDeviceStep = {}): VirtualDeviceResult {
    const networkAvailable = overrides.networkAvailable ?? true
    const sequence = overrides.sequence ?? this.nextSequence()
    const lastSequence = overrides.lastSequence ?? this.lastSequence
    const input = validSafety({ ...overrides, sequence, lastSequence })
    const result = !this.commissioned
      ? { fans: [0, 0] as Pair, sequence, expiresAtMs: input.nowMs + FIRMWARE_PROFILE.shieldMs, reason: 'UNCOMMISSIONED_OUTPUT_DISABLED', permitted: false }
      : networkAvailable
        ? shield(input)
        : { fans: [0, 0] as Pair, sequence, expiresAtMs: input.nowMs + FIRMWARE_PROFILE.shieldMs, reason: 'NETWORK_UNAVAILABLE_TELEMETRY_ONLY', permitted: false }
    const output = networkAvailable && this.commissioned ? driverAccept(result, input.nowMs, lastSequence) : [0, 0] as Pair
    this.output = output
    if (sequence > this.lastSequence) this.lastSequence = sequence
    return { ...result, output, telemetryOnly: true, networkAvailable }
  }

  currentOutput(): Pair {
    return [...this.output]
  }

  private nextSequence(): number {
    this.issuedSequence = this.issuedSequence === 0xffffffff ? 0 : this.issuedSequence + 1
    return this.issuedSequence
  }
}

export function runSafetyVector(name: string): { reason: string; permitted: boolean; output: Pair } {
  const commissioned = name !== 'uncommissioned'
  const device = new VirtualDevice({ commissioned })
  const overrides: VirtualDeviceStep = {}
  if (name === 'stale') { overrides.nowMs = 4000; overrides.measuredAtMs = 0 }
  if (name === 'sensor') overrides.temperatures = [NaN, 7, 7, 7, 7, 7, 7, 7]
  if (name === 'interlock') overrides.interlockClosed = false
  if (name === 'context') overrides.context = 'DOOR_OPEN'
  if (name === 'actuator') overrides.actuatorHealthy = false
  if (name === 'lease') overrides.leaseUntilMs = 1000
  if (name === 'replay') { overrides.sequence = 1; overrides.lastSequence = 1 }
  if (name === 'condensation') overrides.wet = true
  if (name === 'low-limit') overrides.temperatures = [3, 7, 7, 7, 7, 7, 7, 7]
  if (name === 'range') overrides.requested = [0.9, 0.9]
  const result = device.step(overrides)
  return { reason: firmwareReason(result, commissioned), permitted: result.permitted, output: result.output }
}
