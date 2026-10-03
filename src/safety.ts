import { CONTEXTS, SIMULATION_PROFILE } from './contracts.ts'
import type { CanonicalContext } from './contracts.ts'

export type SafetyPair = [number, number]
export const LIMITS = { low: SIMULATION_PROFILE.lowTemperatureC, high: SIMULATION_PROFILE.highTemperatureC, maximum: SIMULATION_PROFILE.maximumDuty, slew: SIMULATION_PROFILE.slewDuty, freshnessMs: SIMULATION_PROFILE.freshnessMs, leaseMs: SIMULATION_PROFILE.leaseMs, shieldMs: SIMULATION_PROFILE.shieldMs, horizonSeconds: SIMULATION_PROFILE.horizonSeconds } as const
export const CANONICAL_CONTEXTS = CONTEXTS

export interface SafetyInput {
  nowMs: number
  context: CanonicalContext
  temperatures: number[]
  measuredAtMs: number
  operatorApproved: boolean
  leaseUntilMs: number
  interlockClosed: boolean
  actuatorHealthy: boolean
  sourceProven: boolean
  wet: boolean
  surfaceMinimum: number | null
  dewPoint: number | null
  combinedU95: number
  requested: SafetyPair
  previous: SafetyPair
  sequence: number
  lastSequence: number
}

export interface Shielded {
  fans: SafetyPair
  sequence: number
  expiresAtMs: number
  reason: string
  permitted: boolean
}

export function shield(input: SafetyInput): Shielded {
  let reason = 'APPROVED_BOUNDED'
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.measuredAtMs) || input.measuredAtMs > input.nowMs || input.nowMs - input.measuredAtMs > LIMITS.freshnessMs) reason = 'STALE_CRITICAL_INPUT'
  else if (input.temperatures.length !== 8 || !input.temperatures.every(value => Number.isFinite(value) && value > -30 && value < 60)) reason = 'INVALID_SENSOR'
  else if (!input.interlockClosed) reason = 'INTERLOCK_OPEN'
  else if (input.context !== 'NORMAL') reason = `CONTEXT_${input.context}`
  else if (!input.sourceProven) reason = 'SOURCE_UNPROVEN'
  else if (!input.actuatorHealthy) reason = 'ACTUATOR_FEEDBACK_FAULT'
  else if (!input.operatorApproved || !Number.isFinite(input.leaseUntilMs) || input.leaseUntilMs <= input.nowMs || input.leaseUntilMs - input.nowMs > LIMITS.leaseMs) reason = 'LEASE_INVALID_OR_EXPIRED'
  else if (!Number.isFinite(input.sequence) || !Number.isInteger(input.sequence) || input.sequence <= input.lastSequence) reason = 'REPLAY_OR_INVALID_SEQUENCE'
  else if (input.wet || input.surfaceMinimum === null || input.dewPoint === null || !Number.isFinite(input.surfaceMinimum) || !Number.isFinite(input.dewPoint) || !Number.isFinite(input.combinedU95) || input.combinedU95 < 0 || input.surfaceMinimum - input.dewPoint < Math.max(2, input.combinedU95)) reason = 'CONDENSATION_UNOBSERVABLE_OR_UNSAFE'
  else if (input.temperatures.slice(0, 6).some(value => value < LIMITS.low)) reason = 'LOW_TEMPERATURE_LIMIT'
  else if (![...input.requested, ...input.previous].every(value => Number.isFinite(value) && value >= 0 && value <= LIMITS.maximum)) reason = 'OUT_OF_RANGE'
  const permitted = reason === 'APPROVED_BOUNDED'
  const fans = permitted ? input.requested.map((value, index) => Math.min(value, input.previous[index] + LIMITS.slew)) as SafetyPair : [0, 0] as SafetyPair
  return { fans, sequence: input.sequence, expiresAtMs: input.nowMs + LIMITS.shieldMs, reason, permitted }
}

export function driverAccept(setpoint: Shielded, nowMs: number, lastSequence: number): SafetyPair {
  if (!setpoint.permitted || !Number.isFinite(nowMs) || nowMs >= setpoint.expiresAtMs || nowMs < setpoint.expiresAtMs - LIMITS.shieldMs || !Number.isInteger(setpoint.sequence) || setpoint.sequence <= lastSequence || !setpoint.fans.every(value => Number.isFinite(value) && value >= 0 && value <= LIMITS.maximum)) return [0, 0]
  return [...setpoint.fans]
}

export function validSafety(overrides: Partial<SafetyInput> = {}): SafetyInput {
  return { nowMs: 1000, context: 'NORMAL', temperatures: [10, 9, 7, 6, 7, 8.5, 3.5, 8], measuredAtMs: 1000, operatorApproved: true, leaseUntilMs: 61000, interlockClosed: true, actuatorHealthy: true, sourceProven: true, wet: false, surfaceMinimum: 4, dewPoint: 0, combinedU95: 0.5, requested: [0.4, 0.4], previous: [0, 0], sequence: 1, lastSequence: 0, ...overrides }
}
