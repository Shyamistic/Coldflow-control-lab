import { FIRMWARE_PROFILE } from '../contracts.ts'
import { configurationForFamily } from './configuration.ts'
import type { ConfigurationFamily, ConfigurationManifest } from './configuration.ts'
import { activeFaults } from './faults.ts'
import type { FaultState } from './faults.ts'
import { createPlant, observePlant, stepPlant } from './plant.ts'
import type { ActuatorState, DisturbanceState, Observation, PlantState } from './plant.ts'
import { driverAccept, shield, validSafety } from '../safety.ts'
import type { SafetyInput, Shielded } from '../safety.ts'
import type { Pair } from '../domain.ts'

export interface AbstractActuatorRequest {
  nowMs: number
  sequence: number
  requested: Pair
  leaseUntilMs: number
  operatorApproved?: boolean
  measuredAtMs?: number
  interlockClosed?: boolean
}

export interface VirtualDeviceStep extends Partial<SafetyInput> {
  commissioned?: boolean
  networkAvailable?: boolean
}

export interface VirtualDeviceResult extends Shielded {
  output: Pair
  telemetryOnly: true
  networkAvailable: boolean
}

export interface LegacyVirtualDeviceResult {
  accepted: boolean
  applied: Pair
  state: 'SAFE_FALLBACK' | 'OBSERVE' | 'AUTO_CORRECT' | 'ABSTAIN' | 'INVESTIGATE_EQUIPMENT'
  reason: string
  observation: Observation
  actuator: ActuatorState
  disturbance: DisturbanceState
  faults: FaultState
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
  readonly manifest: ConfigurationManifest
  private plant: PlantState
  private previous: Pair = [0, 0]
  private lastSequence = 0
  private issuedSequence = 0
  private output: Pair = [0, 0]
  private commissioned: boolean

  constructor(options: { commissioned?: boolean } | ConfigurationFamily | ConfigurationManifest = {}) {
    const isFamily = typeof options === 'string'
    const isManifest = !isFamily && 'version' in options
    this.manifest = isFamily ? configurationForFamily(options) : isManifest ? options : configurationForFamily('normal')
    this.plant = createPlant(this.manifest)
    this.commissioned = isFamily || isManifest ? true : options.commissioned ?? false
  }

  get state(): PlantState { return structuredClone(this.plant) }
  get sequence(): number { return this.lastSequence }

  reboot(): void {
    this.issuedSequence = this.lastSequence
    this.previous = [0, 0]
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

  submit(request: AbstractActuatorRequest): LegacyVirtualDeviceResult {
    const observation = observePlant(this.plant)
    const faults = activeFaults(this.manifest.faults, this.plant.seconds)
    const disturbance = this.disturbance(faults)
    const context = faults.doorOpen ? 'DOOR_OPEN' : faults.defrost ? 'DEFROST' : 'NORMAL'
    const measuredAtMs = faults.sensorStale || faults.networkDelay ? request.nowMs - 2001 : request.measuredAtMs ?? observation.measuredAtMs
    const temperatures = faults.sensorDropout ? [Number.NaN, ...observation.temperaturesC.slice(1), observation.supplyC, observation.returnAirC] : [...observation.temperaturesC, observation.supplyC, observation.returnAirC]
    const safety = shield(validSafety({ nowMs: request.nowMs, context, temperatures, measuredAtMs, operatorApproved: request.operatorApproved ?? true, interlockClosed: request.interlockClosed ?? true, leaseUntilMs: request.leaseUntilMs, actuatorHealthy: !faults.actuatorNoFeedback && !faults.actuatorStuck, sourceProven: this.manifest.source.proven, wet: disturbance.condensationRisk, surfaceMinimum: observation.surfaceMinimumC, dewPoint: observation.dewPointC, requested: request.requested, previous: this.previous, sequence: request.sequence, lastSequence: this.lastSequence }))
    const networkLost = faults.networkLoss
    const applied = networkLost ? [0, 0] as Pair : driverAccept(safety, request.nowMs, this.lastSequence)
    const accepted = !networkLost && safety.permitted && applied.every(value => Number.isFinite(value) && value >= 0)
    if (accepted) { this.previous = applied; this.lastSequence = request.sequence }
    this.output = applied
    const activeFault = faults.active[0]
    const state = accepted ? 'AUTO_CORRECT' : activeFault?.safeState ?? (!this.manifest.source.proven ? 'INVESTIGATE_EQUIPMENT' : 'SAFE_FALLBACK')
    return { accepted, applied, state, reason: networkLost ? 'NETWORK_LOSS' : safety.reason, observation, actuator: { requested: request.requested, applied, feedbackHealthy: !faults.actuatorNoFeedback && !faults.actuatorStuck, powerW: applied.reduce((sum, value) => sum + 8 * value ** 3, 0) }, disturbance, faults }
  }

  tick(request: AbstractActuatorRequest, seconds = 1): LegacyVirtualDeviceResult {
    const result = this.submit(request)
    this.plant = stepPlant(this.plant, result.applied, result.disturbance, result.faults, seconds)
    return result
  }

  currentOutput(): Pair { return [...this.output] }

  private nextSequence(): number {
    this.issuedSequence = this.issuedSequence === 0xffffffff ? 0 : this.issuedSequence + 1
    return this.issuedSequence
  }

  private disturbance(faults: FaultState): DisturbanceState {
    return { sourceTemperatureC: this.manifest.source.temperatureC, doorOpen: this.manifest.door.open || faults.doorOpen, defrost: this.manifest.defrost.active || faults.defrost, humidity: faults.humidityHigh ? 0.95 : this.manifest.humidity.relativeHumidity, condensationRisk: this.manifest.condensation.wet || faults.condensationRisk || faults.humidityHigh }
  }
}

export function replayFamily(family: ConfigurationFamily, durationSeconds = 120, seed = 2026): { family: ConfigurationFamily; seed: number; samples: { observation: ReturnType<typeof observePlant>; faults: ReturnType<typeof activeFaults> }[] } {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) throw new Error('Invalid replay duration')
  const manifest = configurationForFamily(family, seed)
  let plant = createPlant(manifest)
  const samples = []
  for (let second = 0; second < durationSeconds; second += 1) {
    const faults = activeFaults(manifest.faults, plant.seconds)
    const disturbance = { sourceTemperatureC: manifest.source.temperatureC, doorOpen: manifest.door.open || faults.doorOpen, defrost: manifest.defrost.active || faults.defrost, humidity: manifest.humidity.relativeHumidity, condensationRisk: manifest.condensation.wet || faults.condensationRisk }
    plant = stepPlant(plant, [0.4, 0.4], disturbance, faults)
    samples.push({ observation: observePlant(plant), faults })
  }
  return { family, seed, samples }
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
