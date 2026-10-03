import { driverAccept, shield, validSafety } from '../domain.ts'
import type { Pair } from '../domain.ts'
import { configurationForFamily, canonicalHash, type ConfigurationFamily, type ConfigurationManifest } from './configuration.ts'
import { activeFaults, type FaultState } from './faults.ts'
import { createPlant, observePlant, stepPlant, type ActuatorState, type DisturbanceState, type Observation, type PlantState } from './plant.ts'

export interface AbstractActuatorRequest {
  nowMs: number
  sequence: number
  requested: Pair
  leaseUntilMs: number
  operatorApproved?: boolean
  measuredAtMs?: number
}

export interface VirtualDeviceResult {
  accepted: boolean
  applied: Pair
  state: 'SAFE_FALLBACK' | 'OBSERVE' | 'AUTO_CORRECT' | 'ABSTAIN' | 'INVESTIGATE_EQUIPMENT'
  reason: string
  observation: Observation
  actuator: ActuatorState
  disturbance: DisturbanceState
  faults: FaultState
}

export class VirtualDevice {
  readonly manifest: ConfigurationManifest
  private plant: PlantState
  private previous: Pair = [0, 0]
  private lastSequence = 0

  constructor(family: ConfigurationFamily | ConfigurationManifest = 'normal', seed?: number) {
    this.manifest = typeof family === 'string' ? configurationForFamily(family, seed) : family
    this.plant = createPlant(this.manifest)
  }

  get state(): PlantState { return structuredClone(this.plant) }
  get sequence(): number { return this.lastSequence }

  submit(request: AbstractActuatorRequest): VirtualDeviceResult {
    const observation = observePlant(this.plant)
    const faults = activeFaults(this.manifest.faults, this.plant.seconds)
    const disturbance = this.disturbance(faults)
    const context = faults.doorOpen ? 'DOOR_OPEN' : faults.defrost ? 'DEFROST' : 'NORMAL'
    const measuredAtMs = faults.sensorStale || faults.networkDelay ? request.nowMs - 2001 : request.measuredAtMs ?? observation.measuredAtMs
    const temperatures = faults.sensorDropout ? [Number.NaN, ...observation.temperaturesC.slice(1), observation.supplyC, observation.returnAirC] : [...observation.temperaturesC, observation.supplyC, observation.returnAirC]
    const safety = shield(validSafety({ nowMs: request.nowMs, context, temperatures, measuredAtMs, operatorApproved: request.operatorApproved ?? true, leaseUntilMs: request.leaseUntilMs, actuatorHealthy: !faults.actuatorNoFeedback && !faults.actuatorStuck, sourceProven: this.manifest.source.proven, wet: disturbance.condensationRisk, surfaceMinimum: observation.surfaceMinimumC, dewPoint: observation.dewPointC, requested: request.requested, previous: this.previous, sequence: request.sequence, lastSequence: this.lastSequence }))
    const networkLost = faults.networkLoss
    const applied = networkLost ? [0, 0] as Pair : driverAccept(safety, request.nowMs, this.lastSequence)
    const accepted = !networkLost && safety.permitted && applied.some(value => value >= 0)
    if (accepted) { this.previous = applied; this.lastSequence = request.sequence }
    const activeFault = faults.active[0]
    return { accepted, applied, state: accepted ? 'AUTO_CORRECT' : activeFault?.safeState ?? 'SAFE_FALLBACK', reason: networkLost ? 'NETWORK_LOSS' : safety.reason, observation, actuator: { requested: request.requested, applied, feedbackHealthy: !faults.actuatorNoFeedback && !faults.actuatorStuck, powerW: applied.reduce((sum, value) => sum + 8 * value ** 3, 0) }, disturbance, faults }
  }

  tick(request: AbstractActuatorRequest, seconds = 1): VirtualDeviceResult {
    const result = this.submit(request)
    this.plant = stepPlant(this.plant, result.applied, result.disturbance, result.faults, seconds)
    return result
  }

  private disturbance(faults: FaultState): DisturbanceState {
    return { sourceTemperatureC: this.manifest.source.temperatureC, doorOpen: this.manifest.door.open || faults.doorOpen, defrost: this.manifest.defrost.active || faults.defrost, humidity: faults.humidityHigh ? 0.95 : this.manifest.humidity.relativeHumidity, condensationRisk: this.manifest.condensation.wet || faults.condensationRisk || faults.humidityHigh }
  }
}

export function replayFamily(family: ConfigurationFamily, durationSeconds = 60, seed = 2026): { manifestHash: string; outputHash: string; samples: VirtualDeviceResult[] } {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 3600) throw new Error('Invalid replay duration')
  const device = new VirtualDevice(family, seed)
  const samples: VirtualDeviceResult[] = []
  for (let second = 0; second < durationSeconds; second += 1) samples.push(device.tick({ nowMs: second * 1000, sequence: second + 1, requested: [0.4, 0.4], leaseUntilMs: second * 1000 + 60000 }))
  return { manifestHash: device.manifest.manifestHash, outputHash: `fnv1a4:${canonicalHash(samples)}`, samples }
}
