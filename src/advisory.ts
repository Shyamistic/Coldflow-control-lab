import type { Decision } from './domain.ts'

export const ADVISORY_SCHEMA = 'coldflow.advisory.v1' as const
export const ADVISORY_LABELS = ['CORRECTABLE', 'RESTACK_REQUIRED', 'CAPACITY_OR_EQUIPMENT_FAULT', 'SENSOR_OR_EVENT_ARTIFACT', 'UNKNOWN', 'ABSTAIN'] as const
export type AdvisoryLabel = typeof ADVISORY_LABELS[number]
export type AdvisorySource = 'NO_ML_BASELINE' | 'OPTIONAL_SHALLOW_MODEL'

export interface Advisory {
  schema: typeof ADVISORY_SCHEMA
  label: AdvisoryLabel
  reason: string
  confidence: number
  abstain: boolean
  source: AdvisorySource
  modelAdvisoryOnly: true
  directActuatorWrite: false
  safeOutput: readonly [0, 0]
}

export interface AdvisoryInput {
  label: AdvisoryLabel
  reason: string
  confidence?: number
  source?: AdvisorySource
}

export function createAdvisory(input: AdvisoryInput): Advisory {
  const confidence = input.confidence ?? 0
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Advisory confidence must be between 0 and 1')
  return { schema: ADVISORY_SCHEMA, label: input.label, reason: input.reason, confidence, abstain: input.label === 'ABSTAIN' || input.label === 'UNKNOWN', source: input.source ?? 'OPTIONAL_SHALLOW_MODEL', modelAdvisoryOnly: true, directActuatorWrite: false, safeOutput: [0, 0] }
}

export function advisoryForDecision(decision: Decision, reason: string): Advisory {
  const label: AdvisoryLabel = decision === 'AUTO_CORRECT' ? 'CORRECTABLE' : decision === 'INVESTIGATE_EQUIPMENT' ? 'CAPACITY_OR_EQUIPMENT_FAULT' : decision === 'SAFE_FALLBACK' ? 'SENSOR_OR_EVENT_ARTIFACT' : decision === 'ABSTAIN' ? 'ABSTAIN' : 'UNKNOWN'
  const confidence = decision === 'AUTO_CORRECT' || decision === 'INVESTIGATE_EQUIPMENT' ? 0.75 : 0
  return createAdvisory({ label, reason, confidence, source: 'NO_ML_BASELINE' })
}

export function advisoryFromModel(input: Omit<AdvisoryInput, 'source'> & { source?: 'OPTIONAL_SHALLOW_MODEL' }): Advisory {
  return createAdvisory({ ...input, source: 'OPTIONAL_SHALLOW_MODEL' })
}
