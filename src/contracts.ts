export const SCHEMA_VERSION = '1.0' as const
export const SIMULATION_COMPATIBILITY_VALUE = 'SIMULATION' as const

export const EVIDENCE_CLASSES = ['SIMULATED', 'REPLAY', 'LIVE_TABLETOP', 'FIELD_DATA'] as const
export type EvidenceClass = typeof EVIDENCE_CLASSES[number]
export type PublicEvidenceClass = EvidenceClass | typeof SIMULATION_COMPATIBILITY_VALUE

export const LABELS = ['CORRECTABLE', 'RESTACK_REQUIRED', 'CAPACITY_OR_EQUIPMENT_FAULT', 'SENSOR_OR_EVENT_ARTIFACT', 'UNKNOWN', 'ABSTAIN'] as const
export type Label = typeof LABELS[number]

export const CONTEXTS = ['NORMAL', 'DOOR_OPEN', 'DEFROST', 'DRIP', 'FAN_DELAY', 'POST_EVENT_RECOVERY', 'SOURCE_UNKNOWN'] as const
export type CanonicalContext = typeof CONTEXTS[number]

export const OPERATING_STATES = ['SAFE_BOOT', 'SELF_TEST', 'SAFE_FIXED', 'OBSERVE', 'IDENTIFYING', 'AUTO_CORRECT', 'ABSTAIN', 'INVESTIGATE_EQUIPMENT', 'RESTACK_REQUIRED', 'SAFE_FALLBACK', 'MAINTENANCE'] as const
export type OperatingState = typeof OPERATING_STATES[number]

export const TRANSITION_EVENTS = ['BOOT_OK', 'BOOT_FAULT', 'PASS', 'FAIL', 'OBSERVE_REQUEST', 'IDENTIFY', 'IDENTIFIED', 'UNCERTAIN', 'UNSAFE', 'EQUIPMENT_FAULT', 'RESTACK_REQUIRED', 'STOP', 'RECOVER', 'RESET', 'MAINTENANCE_REQUEST', 'EXIT_MAINTENANCE'] as const
export type TransitionEvent = typeof TRANSITION_EVENTS[number]

export interface StateTransition {
  from: OperatingState
  event: TransitionEvent
  to: OperatingState
}

export const TRANSITIONS: readonly StateTransition[] = [
  { from: 'SAFE_BOOT', event: 'BOOT_OK', to: 'SELF_TEST' },
  { from: 'SAFE_BOOT', event: 'BOOT_FAULT', to: 'SAFE_FALLBACK' },
  { from: 'SELF_TEST', event: 'PASS', to: 'SAFE_FIXED' },
  { from: 'SELF_TEST', event: 'FAIL', to: 'SAFE_FALLBACK' },
  { from: 'SAFE_FIXED', event: 'OBSERVE_REQUEST', to: 'OBSERVE' },
  { from: 'SAFE_FIXED', event: 'MAINTENANCE_REQUEST', to: 'MAINTENANCE' },
  { from: 'OBSERVE', event: 'IDENTIFY', to: 'IDENTIFYING' },
  { from: 'OBSERVE', event: 'BOOT_FAULT', to: 'SAFE_FALLBACK' },
  { from: 'OBSERVE', event: 'MAINTENANCE_REQUEST', to: 'MAINTENANCE' },
  { from: 'IDENTIFYING', event: 'IDENTIFIED', to: 'AUTO_CORRECT' },
  { from: 'IDENTIFYING', event: 'UNCERTAIN', to: 'ABSTAIN' },
  { from: 'IDENTIFYING', event: 'BOOT_FAULT', to: 'SAFE_FALLBACK' },
  { from: 'AUTO_CORRECT', event: 'UNSAFE', to: 'ABSTAIN' },
  { from: 'AUTO_CORRECT', event: 'EQUIPMENT_FAULT', to: 'INVESTIGATE_EQUIPMENT' },
  { from: 'AUTO_CORRECT', event: 'RESTACK_REQUIRED', to: 'RESTACK_REQUIRED' },
  { from: 'AUTO_CORRECT', event: 'STOP', to: 'OBSERVE' },
  { from: 'AUTO_CORRECT', event: 'BOOT_FAULT', to: 'SAFE_FALLBACK' },
  { from: 'ABSTAIN', event: 'EQUIPMENT_FAULT', to: 'INVESTIGATE_EQUIPMENT' },
  { from: 'ABSTAIN', event: 'RESTACK_REQUIRED', to: 'RESTACK_REQUIRED' },
  { from: 'ABSTAIN', event: 'RECOVER', to: 'OBSERVE' },
  { from: 'ABSTAIN', event: 'MAINTENANCE_REQUEST', to: 'MAINTENANCE' },
  { from: 'INVESTIGATE_EQUIPMENT', event: 'RESTACK_REQUIRED', to: 'RESTACK_REQUIRED' },
  { from: 'INVESTIGATE_EQUIPMENT', event: 'RECOVER', to: 'OBSERVE' },
  { from: 'INVESTIGATE_EQUIPMENT', event: 'BOOT_FAULT', to: 'SAFE_FALLBACK' },
  { from: 'RESTACK_REQUIRED', event: 'RESET', to: 'SAFE_FIXED' },
  { from: 'RESTACK_REQUIRED', event: 'MAINTENANCE_REQUEST', to: 'MAINTENANCE' },
  { from: 'SAFE_FALLBACK', event: 'RESET', to: 'SAFE_BOOT' },
  { from: 'SAFE_FALLBACK', event: 'MAINTENANCE_REQUEST', to: 'MAINTENANCE' },
  { from: 'MAINTENANCE', event: 'EXIT_MAINTENANCE', to: 'SAFE_BOOT' },
  { from: 'MAINTENANCE', event: 'BOOT_FAULT', to: 'SAFE_FALLBACK' },
]

export interface TransitionResult {
  state: OperatingState
  accepted: boolean
  reason: 'TRANSITION_ACCEPTED' | 'TRANSITION_REJECTED_SAFE_FALLBACK'
}

export function transition(state: OperatingState, event: TransitionEvent): TransitionResult {
  const match = TRANSITIONS.find(candidate => candidate.from === state && candidate.event === event)
  return match
    ? { state: match.to, accepted: true, reason: 'TRANSITION_ACCEPTED' }
    : { state: 'SAFE_FALLBACK', accepted: false, reason: 'TRANSITION_REJECTED_SAFE_FALLBACK' }
}

export const SIMULATION_PROFILE = {
  lowTemperatureC: 4,
  highTemperatureC: 8,
  maximumDuty: 0.8,
  slewDuty: 0.1,
  freshnessMs: 2000,
  leaseMs: 60000,
  shieldMs: 200,
  horizonSeconds: 120,
} as const

export const FIRMWARE_PROFILE = {
  lowTemperatureC: 4,
  maximumDuty: 0.4,
  slewDuty: 0.05,
  freshnessMs: 2000,
  leaseMs: 30000,
  shieldMs: 200,
} as const

export const SAFETY_REASONS = {
  approved: 'APPROVED_BOUNDED',
  stale: 'STALE_CRITICAL_INPUT',
  invalidSensor: 'INVALID_SENSOR',
  interlock: 'INTERLOCK_OPEN',
  context: 'CONTEXT_INHIBIT',
  source: 'SOURCE_UNPROVEN',
  actuator: 'ACTUATOR_FEEDBACK_FAULT',
  lease: 'LEASE_INVALID_OR_EXPIRED',
  replay: 'REPLAY_OR_INVALID_SEQUENCE',
  condensation: 'CONDENSATION_UNOBSERVABLE_OR_UNSAFE',
  lowLimit: 'LOW_TEMPERATURE_LIMIT',
  range: 'OUT_OF_RANGE',
  uncommissioned: 'UNCOMMISSIONED_OUTPUT_DISABLED',
} as const

export function canonicalEvidence(value: PublicEvidenceClass): EvidenceClass {
  return value === SIMULATION_COMPATIBILITY_VALUE ? 'SIMULATED' : value
}

export function publicEvidence(value: EvidenceClass): PublicEvidenceClass {
  return value === 'SIMULATED' ? SIMULATION_COMPATIBILITY_VALUE : value
}

export function stateForDecision(decision: string): OperatingState {
  if (decision === 'OBSERVE' || decision === 'IDENTIFYING' || decision === 'AUTO_CORRECT' || decision === 'ABSTAIN' || decision === 'INVESTIGATE_EQUIPMENT' || decision === 'SAFE_FALLBACK') return decision
  return 'SAFE_FALLBACK'
}
