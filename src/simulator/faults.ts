export const FAULT_NAMES = ['SENSOR_STALE', 'SENSOR_DROPOUT', 'ACTUATOR_NO_FEEDBACK', 'ACTUATOR_STUCK', 'NETWORK_DELAY', 'NETWORK_LOSS', 'DOOR_OPEN', 'DEFROST', 'HUMIDITY_HIGH', 'CONDENSATION_RISK'] as const
export type FaultName = typeof FAULT_NAMES[number]

export interface FaultEvent {
  name: FaultName
  startSeconds: number
  endSeconds: number
  reason: string
  safeState: 'SAFE_FALLBACK' | 'ABSTAIN' | 'INVESTIGATE_EQUIPMENT'
  safeOutput: 'ZERO_COMMAND' | 'STALE_OBSERVATION' | 'INHIBIT_MOTION'
}

export interface FaultState {
  active: readonly FaultEvent[]
  sensorStale: boolean
  sensorDropout: boolean
  actuatorNoFeedback: boolean
  actuatorStuck: boolean
  networkDelay: boolean
  networkLoss: boolean
  doorOpen: boolean
  defrost: boolean
  humidityHigh: boolean
  condensationRisk: boolean
}

export const FAULT_BEHAVIORS: Readonly<Record<FaultName, Pick<FaultEvent, 'reason' | 'safeState' | 'safeOutput'>>> = {
  SENSOR_STALE: { reason: 'STALE_CRITICAL_INPUT', safeState: 'SAFE_FALLBACK', safeOutput: 'STALE_OBSERVATION' },
  SENSOR_DROPOUT: { reason: 'INVALID_SENSOR', safeState: 'SAFE_FALLBACK', safeOutput: 'ZERO_COMMAND' },
  ACTUATOR_NO_FEEDBACK: { reason: 'ACTUATOR_FEEDBACK_FAULT', safeState: 'SAFE_FALLBACK', safeOutput: 'ZERO_COMMAND' },
  ACTUATOR_STUCK: { reason: 'ACTUATOR_FEEDBACK_FAULT', safeState: 'SAFE_FALLBACK', safeOutput: 'ZERO_COMMAND' },
  NETWORK_DELAY: { reason: 'STALE_CRITICAL_INPUT', safeState: 'SAFE_FALLBACK', safeOutput: 'STALE_OBSERVATION' },
  NETWORK_LOSS: { reason: 'NETWORK_LOSS', safeState: 'SAFE_FALLBACK', safeOutput: 'ZERO_COMMAND' },
  DOOR_OPEN: { reason: 'CONTEXT_DOOR_OPEN', safeState: 'ABSTAIN', safeOutput: 'INHIBIT_MOTION' },
  DEFROST: { reason: 'CONTEXT_DEFROST', safeState: 'ABSTAIN', safeOutput: 'INHIBIT_MOTION' },
  HUMIDITY_HIGH: { reason: 'CONDENSATION_UNOBSERVABLE_OR_UNSAFE', safeState: 'SAFE_FALLBACK', safeOutput: 'ZERO_COMMAND' },
  CONDENSATION_RISK: { reason: 'CONDENSATION_UNOBSERVABLE_OR_UNSAFE', safeState: 'SAFE_FALLBACK', safeOutput: 'ZERO_COMMAND' },
}

export function createFaultEvent(name: FaultName, startSeconds: number, endSeconds: number): FaultEvent {
  if (!Number.isInteger(startSeconds) || !Number.isInteger(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) throw new Error('Invalid fault interval')
  const behavior = FAULT_BEHAVIORS[name]
  return { name, startSeconds, endSeconds, ...behavior }
}

export function activeFaults(events: readonly FaultEvent[], seconds: number): FaultState {
  const active = events.filter(event => seconds >= event.startSeconds && seconds < event.endSeconds)
  const has = (name: FaultName) => active.some(event => event.name === name)
  return {
    active,
    sensorStale: has('SENSOR_STALE'),
    sensorDropout: has('SENSOR_DROPOUT'),
    actuatorNoFeedback: has('ACTUATOR_NO_FEEDBACK'),
    actuatorStuck: has('ACTUATOR_STUCK'),
    networkDelay: has('NETWORK_DELAY'),
    networkLoss: has('NETWORK_LOSS'),
    doorOpen: has('DOOR_OPEN'),
    defrost: has('DEFROST'),
    humidityHigh: has('HUMIDITY_HIGH'),
    condensationRisk: has('CONDENSATION_RISK'),
  }
}

export function faultMatrix(events: readonly FaultEvent[]): readonly { name: FaultName; reason: string; safeState: FaultEvent['safeState']; safeOutput: FaultEvent['safeOutput'] }[] {
  return [...new Map(events.map(event => [event.name, { name: event.name, reason: event.reason, safeState: event.safeState, safeOutput: event.safeOutput }])).values()]
}
