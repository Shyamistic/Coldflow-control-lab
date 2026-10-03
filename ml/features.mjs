import { createHash } from 'node:crypto'

export const FEATURE_SCHEMA = 'coldflow.advisory-features.v1'
export const FEATURE_NAMES = ['meanTemperatureC', 'spreadC', 'supplyC', 'maxSlopeCPerSecond']
export const FEATURE_SOURCE = 'coldflow.frozen-features.v1'

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

function finiteFeatures(features) {
  return FEATURE_NAMES.every(name => Number.isFinite(features?.[name])) && features.futureSamplesUsed === false
}

export function featuresForGroup(group) {
  if (!group?.family || !group.runId || !Number.isInteger(group.seed)) throw new Error('Invalid evaluation group')
  if (group.canonicalSimulator?.source !== 'VERSIONED_PLANT_VIRTUAL_DEVICE') throw new Error('Evaluation group is not canonical simulator evidence')
  const frozen = group.frozenFeatures ?? group.pulseBlocks?.[0]?.frozenFeatures
  if (!finiteFeatures(frozen)) throw new Error(`Invalid canonical frozen features for ${group.groupId ?? group.runId}`)
  return {
    schema: FEATURE_SCHEMA,
    groupId: group.groupId,
    family: group.family,
    runId: group.runId,
    seed: group.seed,
    sourceSchema: FEATURE_SOURCE,
    simulatorSource: group.canonicalSimulator.source,
    simulatorVersion: group.canonicalSimulator.simulatorVersion,
    manifestHashes: group.canonicalSimulator.manifestHashes,
    decisionSecond: frozen.decisionSecond,
    windowStartSecond: frozen.windowStartSecond,
    windowEndSecond: frozen.windowEndSecond,
    futureSamplesUsed: frozen.futureSamplesUsed,
    values: FEATURE_NAMES.map(name => frozen[name]),
  }
}

export function rowsFromEvaluation(report, { families = report?.configurationFamilies ?? [], seeds = report?.seeds ?? [] } = {}) {
  if (report?.schema !== 'coldflow.simulation-evaluation.v1') throw new Error('FEAT-005 evaluation report is required')
  if (report.provenance?.physicalHardwareAssembled !== false || report.provenance?.actuatorAuthority !== false) throw new Error('Evaluation report exceeds simulation-only boundary')
  if (report.provenance?.source !== 'CANONICAL_VERSIONED_PLANT_VIRTUAL_DEVICE') throw new Error('Evaluation report is not canonical simulator evidence')
  if (report.protocol?.futureLeakage !== false || report.protocol?.frozenFeatures !== true || report.grouping?.groupOverlap !== false) throw new Error('Evaluation report does not prove frozen grouped inputs')
  const familySet = new Set(families)
  const seedSet = new Set(seeds)
  const rows = report.groups
    .filter(group => familySet.has(group.family) && seedSet.has(group.seed))
    .map(group => ({ ...featuresForGroup(group), label: group.label?.label }))
    .sort((left, right) => left.groupId.localeCompare(right.groupId))
  if (rows.length === 0) throw new Error('No requested evaluation groups found')
  if (rows.some(row => !row.label)) throw new Error('Evaluation group has no synthetic label')
  return rows
}

export function manifestHash(rows) {
  return sha256({ schema: FEATURE_SCHEMA, featureNames: FEATURE_NAMES, rows })
}

export function leaveOneFamilyOut(rows) {
  const families = [...new Set(rows.map(row => row.family))].sort()
  if (families.length < 2) throw new Error('At least two configuration families are required for grouped holdouts')
  return families.map(holdoutFamily => {
    const holdout = rows.filter(row => row.family === holdoutFamily)
    const train = rows.filter(row => row.family !== holdoutFamily)
    const trainGroups = train.map(row => row.groupId).sort()
    const holdoutGroups = holdout.map(row => row.groupId).sort()
    if (new Set(trainGroups).intersection(new Set(holdoutGroups)).size) throw new Error('Grouped split overlap detected')
    return { holdoutFamily, train, holdout, trainGroups, holdoutGroups }
  })
}

export function vectorFromFeatures(features) {
  if (Array.isArray(features?.values)) {
    if (features.values.length !== FEATURE_NAMES.length || !features.values.every(Number.isFinite)) throw new Error('Invalid feature vector')
    return [...features.values]
  }
  const values = FEATURE_NAMES.map(name => features?.[name])
  if (!values.every(Number.isFinite)) throw new Error('Invalid feature object')
  return values
}
