import { EVIDENCE_CLASSES, MODEL_VERSION } from '../recorder/manifest.mjs'

export const LABELS = ['CORRECTABLE', 'RESTACK_REQUIRED', 'CAPACITY_OR_EQUIPMENT_FAULT', 'SENSOR_OR_EVENT_ARTIFACT', 'UNKNOWN', 'ABSTAIN']

function provenanceLabel({ label, evidenceClass, source, configurationFamily, runId, seed, reason, intervention, reviewer, custodian }) {
  const outcome = reason === 'NO_EXCURSION_ALREADY_IN_TARGET' ? 'NO_ACTION' : label === 'CORRECTABLE' ? 'CORRECTED' : label === 'ABSTAIN' || label === 'UNKNOWN' ? 'ABSTAIN' : 'EVIDENCE_GATED_FAILURE'
  return {
    schema: 'coldflow.label.v1',
    schemaVersion: '1.0',
    label,
    outcome,
    evidenceClass,
    source,
    configurationFamily,
    runId,
    seed,
    reason,
    intervention,
    reviewer,
    custodian,
    modelVersion: MODEL_VERSION,
    confidence: label === 'ABSTAIN' || label === 'UNKNOWN' ? 0 : 0.75,
    modelAdvisoryOnly: true,
  }
}

export function classifySyntheticLabel({ family, runId = 'unassigned', seed = 2026, evidenceClass = 'SIMULATED', source = 'SYNTHETIC_RULE', evidence = {} } = {}) {
  const common = { evidenceClass, source, configurationFamily: family, runId, seed, reviewer: 'UNREVIEWED_SYNTHETIC', custodian: 'COLD FLOW SIMULATION' }
  const unsafeProvenance = evidence.replayedAsLive || source === 'REPLAY' && (evidenceClass === 'LIVE_TABLETOP' || evidenceClass === 'FIELD_DATA') || evidenceClass !== 'SIMULATED' && source === 'SYNTHETIC_RULE'
  if (unsafeProvenance || evidence.insufficient || evidence.stale || evidence.contradictory) {
    return provenanceLabel({ ...common, label: evidence.insufficient || evidence.stale || evidence.contradictory ? 'UNKNOWN' : 'ABSTAIN', reason: evidence.insufficient ? 'INSUFFICIENT_EVIDENCE' : evidence.stale ? 'STALE_EVIDENCE' : evidence.contradictory ? 'CONTRADICTORY_EVIDENCE' : 'REPLAYED_OR_LIVE_PROVENANCE_MISMATCH', intervention: 'NONE' })
  }
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) throw new Error(`Unknown evidence class: ${evidenceClass}`)
  const normalizedFamily = String(family).toLowerCase()
  if (normalizedFamily.startsWith('capacity')) return provenanceLabel({ ...common, label: 'CAPACITY_OR_EQUIPMENT_FAULT', reason: 'DECLARED_SYNTHETIC_SOURCE_CAPACITY_RULE', intervention: 'INHIBIT_SIMULATED_COMMAND' })
  if (normalizedFamily.startsWith('fault-matrix')) return provenanceLabel({ ...common, label: 'SENSOR_OR_EVENT_ARTIFACT', reason: 'DECLARED_SYNTHETIC_SENSOR_OR_EVENT_RULE', intervention: 'SAFE_FALLBACK' })
  if (normalizedFamily.startsWith('obstructed')) {
    const matchedFailure = evidence.boundedInterventionObserved === true && evidence.robustReachabilityFailed === true && evidence.matchedPathClearImproved === true
    if (matchedFailure) return provenanceLabel({ ...common, label: 'RESTACK_REQUIRED', reason: 'OBSERVED_BOUNDED_INTERVENTION_FAILED_MATCHED_PATH_CLEAR_IMPROVED', intervention: 'INSPECT_OR_RESTACK_IN_FUTURE_QUALIFIED_WORKFLOW' })
    if (evidence.boundedInterventionPassed === true && evidence.authoritySufficient === true) return provenanceLabel({ ...common, label: 'CORRECTABLE', reason: 'OBSERVED_SYNTHETIC_BOUNDED_AIRFLOW_CORRECTION', intervention: 'BOUNDED_SIMULATED_AIRFLOW' })
    return provenanceLabel({ ...common, label: 'ABSTAIN', reason: 'INSUFFICIENT_MATCHED_INTERVENTION_EVIDENCE', intervention: 'NONE' })
  }
  if (normalizedFamily.startsWith('correctable') && evidence.initialExcursion === true && evidence.boundedInterventionPassed === true && evidence.authoritySufficient === true) return provenanceLabel({ ...common, label: 'CORRECTABLE', reason: 'OBSERVED_SYNTHETIC_BOUNDED_CORRECTION_OF_DECLARED_EXCURSION', intervention: 'BOUNDED_SIMULATED_AIRFLOW' })
  if (normalizedFamily.startsWith('normal') && evidence.noExcursion === true) return provenanceLabel({ ...common, label: 'ABSTAIN', reason: 'NO_EXCURSION_ALREADY_IN_TARGET', intervention: 'NONE' })
  if (normalizedFamily.startsWith('normal') && evidence.boundedInterventionPassed === true && evidence.authoritySufficient === true) return provenanceLabel({ ...common, label: 'CORRECTABLE', reason: 'OBSERVED_SYNTHETIC_BOUNDED_CORRECTION_RULE', intervention: 'BOUNDED_SIMULATED_AIRFLOW' })
  return provenanceLabel({ ...common, label: 'ABSTAIN', reason: 'NO_EXCURSION_OR_DIAGNOSTIC_EVIDENCE', intervention: 'NONE' })
}

export function assertLabel(label) {
  if (!label || label.schema !== 'coldflow.label.v1' || label.schemaVersion !== '1.0' || !LABELS.includes(label.label)) throw new Error('Invalid ground-truth label')
  if (!['NO_ACTION', 'CORRECTED', 'EVIDENCE_GATED_FAILURE', 'ABSTAIN'].includes(label.outcome)) throw new Error('Invalid ground-truth outcome')
  if (!EVIDENCE_CLASSES.includes(label.evidenceClass) || !label.configurationFamily || !label.runId || !Number.isInteger(label.seed) || !label.reason || !label.intervention || !label.reviewer || !label.custodian || label.modelAdvisoryOnly !== true) throw new Error('Incomplete ground-truth provenance')
  if ((label.evidenceClass === 'SIMULATED' || label.evidenceClass === 'REPLAY') && (label.source === 'TABLETOP' || label.source === 'FIELD')) throw new Error('Synthetic evidence cannot claim physical source')
  if (label.label === 'CORRECTABLE' && label.outcome !== 'CORRECTED') throw new Error('Correctable label outcome mismatch')
  if (label.reason === 'NO_EXCURSION_ALREADY_IN_TARGET' && label.outcome !== 'NO_ACTION') throw new Error('No-excursion label outcome mismatch')
  return label
}
