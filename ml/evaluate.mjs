import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { FEATURE_NAMES, sha256, vectorFromFeatures } from './features.mjs'
import { FIXED_GENERATED_AT, MODEL_SCHEMA, renderModelCard } from './train.mjs'

export const EVALUATION_SCHEMA = 'coldflow.advisory-evaluation.v1'
export const SELECTION_MARGIN = 0.05
const LABELS = ['CORRECTABLE', 'RESTACK_REQUIRED', 'CAPACITY_OR_EQUIPMENT_FAULT', 'SENSOR_OR_EVENT_ARTIFACT', 'UNKNOWN', 'ABSTAIN']

function parseArguments(argumentsList = process.argv.slice(2)) {
  const values = {}
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (!argument.startsWith('--')) continue
    const [key, inline] = argument.slice(2).split('=', 2)
    values[key] = inline ?? argumentsList[index + 1]
    if (inline === undefined) index += 1
  }
  return { model: values.model ?? 'artifacts/ml/candidate.json', output: values.output ?? 'artifacts/ml/evaluation.json' }
}

function distance(values, centroid, scales) {
  return Math.sqrt(values.reduce((sum, value, index) => sum + ((value - centroid[index]) / scales[index]) ** 2, 0))
}

export function predictFold(fold, features) {
  const values = vectorFromFeatures(features)
  const candidates = fold.labels.map(label => ({ label, distance: distance(values, fold.centroids[label], fold.scales) })).sort((left, right) => left.distance - right.distance || left.label.localeCompare(right.label))
  const nearest = candidates[0]
  const isOOD = !nearest || nearest.distance > fold.oodThreshold
  const confidence = isOOD ? 0 : Number((1 / (1 + nearest.distance)).toFixed(6))
  return {
    label: isOOD ? 'ABSTAIN' : nearest.label,
    reason: isOOD ? 'OOD_INPUT' : 'WITHIN_SYNTHETIC_TRAINING_ENVELOPE',
    confidence,
    distance: Number((nearest?.distance ?? Number.POSITIVE_INFINITY).toFixed(6)),
    isOOD,
    modelAdvisoryOnly: true,
    directActuatorWrite: false,
    safeOutput: [0, 0],
    shieldAuthoritative: true,
  }
}

function confusionMatrix(rows) {
  const matrix = Object.fromEntries(LABELS.map(actual => [actual, Object.fromEntries(LABELS.map(predicted => [predicted, 0]))]))
  for (const row of rows) {
    if (!matrix[row.actual]) matrix[row.actual] = {}
    matrix[row.actual][row.predicted] = (matrix[row.actual][row.predicted] ?? 0) + 1
  }
  return matrix
}

function calibration(rows) {
  const bins = Array.from({ length: 5 }, (_, index) => ({ bin: index, count: 0, confidence: 0, accuracy: 0 }))
  for (const row of rows) {
    const index = Math.min(4, Math.floor(row.confidence * 5))
    bins[index].count += 1
    bins[index].confidence += row.confidence
    bins[index].accuracy += row.predicted === row.actual ? 1 : 0
  }
  for (const bin of bins) {
    if (bin.count) { bin.confidence = Number((bin.confidence / bin.count).toFixed(6)); bin.accuracy = Number((bin.accuracy / bin.count).toFixed(6)) }
  }
  const expectedCalibrationError = bins.reduce((sum, bin) => sum + (bin.count ? Math.abs(bin.confidence - bin.accuracy) * bin.count : 0), 0) / Math.max(rows.length, 1)
  return { bins, expectedCalibrationError: Number(expectedCalibrationError.toFixed(6)) }
}

function actionableUtility(rows) {
  const actionable = rows.filter(row => row.actual !== 'ABSTAIN')
  const correct = actionable.filter(row => row.predicted === row.actual).length
  const incorrect = actionable.filter(row => row.predicted !== row.actual && row.predicted !== 'ABSTAIN').length
  return correct - incorrect
}

function metricFor(rows, model) {
  const total = rows.length
  const correct = rows.filter(row => row.predicted === row.actual).length
  const abstained = rows.filter(row => row.predicted === 'ABSTAIN').length
  const falseCorrectableRows = rows.filter(row => row.actual === 'RESTACK_REQUIRED' && row.predicted === 'CORRECTABLE')
  const unsafeAuthorizationRows = rows.filter(row => row.directActuatorWrite || row.safeOutput.some(value => value !== 0))
  const bySeed = Object.groupBy(rows, row => String(row.seed))
  const seedAccuracy = Object.fromEntries(Object.entries(bySeed).sort(([left], [right]) => left.localeCompare(right)).map(([seed, seedRows]) => [seed, Number((seedRows.filter(row => row.predicted === row.actual).length / seedRows.length).toFixed(6))]))
  const values = Object.values(seedAccuracy)
  const utility = Number(((actionableUtility(rows) - falseCorrectableRows.length * 2) / Math.max(total, 1)).toFixed(6))
  const inDistribution = rows.filter(row => !row.isOOD)
  const syntheticOOD = model.folds.map(fold => predictFold(fold, { values: [22, 18, 12, 1] }))
  return {
    total,
    correct,
    accuracy: Number((correct / Math.max(total, 1)).toFixed(6)),
    abstained,
    abstentionRate: Number((abstained / Math.max(total, 1)).toFixed(6)),
    utility,
    confusion: confusionMatrix(rows),
    calibration: calibration(rows),
    ood: { total: syntheticOOD.length, detected: syntheticOOD.filter(item => item.isOOD).length, falseAbstention: inDistribution.filter(item => item.predicted === 'ABSTAIN').length, cases: syntheticOOD },
    seedSensitivity: { perSeedAccuracy: seedAccuracy, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0, range: values.length ? Number((Math.max(...values) - Math.min(...values)).toFixed(6)) : 0 },
    resource: { featureCount: FEATURE_NAMES.length, foldCount: model.folds.length, modelBytes: Buffer.byteLength(JSON.stringify(model), 'utf8'), inferenceDistanceOperations: total * model.folds.length * FEATURE_NAMES.length },
    falseCorrectable: { count: falseCorrectableRows.length, rate: Number((falseCorrectableRows.length / Math.max(rows.filter(row => row.actual === 'RESTACK_REQUIRED').length, 1)).toFixed(6)) },
    unsafeAuthorizationRisk: { count: unsafeAuthorizationRows.length, rate: Number((unsafeAuthorizationRows.length / Math.max(total, 1)).toFixed(6)) },
  }
}

export function evaluateModel(model) {
  if (model?.schema !== MODEL_SCHEMA || model.safety?.directActuatorWrite !== false || model.safety?.advisoryOnly !== true) throw new Error('Invalid or actuator-authoritative model artifact')
  const { artifactHash, ...unsignedArtifact } = model
  if (!artifactHash || sha256(unsignedArtifact) !== artifactHash) throw new Error('Model artifact hash mismatch')
  const rows = []
  const foldResults = []
  for (const fold of model.folds) {
    const foldRows = model.manifest.rows.filter(row => fold.holdoutGroups.includes(row.groupId))
    const predictions = foldRows.map(row => { const prediction = predictFold(fold, row); return { groupId: row.groupId, family: row.family, runId: row.runId, seed: row.seed, actual: row.label, predicted: prediction.label, ...prediction, fold: fold.holdoutFamily } })
    rows.push(...predictions)
    foldResults.push({ holdoutFamily: fold.holdoutFamily, groups: fold.holdoutGroups, rows: predictions.length })
  }
  const metrics = metricFor(rows, model)
  const baseline = { name: 'NO_ML_BASELINE', utility: 0, falseCorrectableRate: 0, unsafeAuthorizationRisk: 0, decision: 'ABSTAIN' }
  const selection = {
    rule: { minimumUtilityMargin: SELECTION_MARGIN, noIncreaseInFalseCorrectableRisk: true, noUnsafeAuthorizationRisk: true, requiresHeldOutFamilyGroups: true },
    baseline,
    candidate: { utility: metrics.utility, utilityImprovement: Number((metrics.utility - baseline.utility).toFixed(6)), falseCorrectableRate: metrics.falseCorrectable.rate, unsafeAuthorizationRisk: metrics.unsafeAuthorizationRisk.rate },
    decision: metrics.utility >= SELECTION_MARGIN && metrics.falseCorrectable.rate <= baseline.falseCorrectableRate && metrics.unsafeAuthorizationRisk.rate <= baseline.unsafeAuthorizationRisk ? 'OPTIONAL_ADVISORY_MODEL' : 'NO_ML_BASELINE',
    reason: metrics.utility >= SELECTION_MARGIN && metrics.falseCorrectable.rate <= baseline.falseCorrectableRate && metrics.unsafeAuthorizationRisk.rate <= baseline.unsafeAuthorizationRisk ? 'HELD_OUT_UTILITY_MARGIN_MET' : 'HELD_OUT_UTILITY_MARGIN_OR_SAFETY_GATE_NOT_MET',
  }
  return {
    schema: EVALUATION_SCHEMA,
    schemaVersion: '1.0',
    generatedAt: FIXED_GENERATED_AT,
    provenance: { evidenceClass: 'SIMULATED', source: 'FEAT-005_NO_ML_EVALUATION', physicalHardwareAssembled: false, directActuatorWrite: false, modelAdvisoryOnly: true, modelArtifactHash: model.artifactHash },
    protocol: { featureSchema: model.featureSchema, featureNames: FEATURE_NAMES, frozenPreDecisionFeatures: true, futureLeakage: false, groupedSplit: model.grouping.split, heldOutFamilies: model.folds.map(fold => fold.holdoutFamily) },
    grouping: model.grouping,
    folds: foldResults,
    metrics,
    predictions: rows,
    selection,
    machineReadable: true,
  }
}

function decisionRecord(evaluation) {
  return {
    schema: 'coldflow.model-selection.v1',
    schemaVersion: '1.0',
    generatedAt: FIXED_GENERATED_AT,
    decision: evaluation.selection.decision,
    reason: evaluation.selection.reason,
    evidenceClass: 'SIMULATED',
    evaluationSchema: evaluation.schema,
    modelArtifactHash: evaluation.provenance.modelArtifactHash,
    utilityMetric: evaluation.selection.rule,
    baseline: evaluation.selection.baseline,
    candidate: evaluation.selection.candidate,
    safetyBoundary: { modelAdvisoryOnly: true, directActuatorWrite: false, safeOutput: [0, 0], deterministicShieldAuthoritative: true, removable: true },
    limitations: ['Synthetic simulator labels and seeds are not physical evidence.', 'No model is authorized to select or write an actuator command.', 'Physical calibration, transfer and independent hardware evidence remain required.'],
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList)
  const modelText = await readFile(resolve(options.model), 'utf8')
  const model = JSON.parse(modelText)
  const evaluation = evaluateModel(model)
  await mkdir(dirname(resolve(options.output)), { recursive: true })
  await writeFile(resolve(options.output), `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8')
  const decision = decisionRecord(evaluation)
  await writeFile('ml/decision-record.json', `${JSON.stringify(decision, null, 2)}\n`, 'utf8')
  await writeFile('ml/model-card.md', renderModelCard(model, evaluation), 'utf8')
  process.stdout.write(`Wrote ${options.output}: ${evaluation.metrics.total} held-out rows, decision ${evaluation.selection.decision}\n`)
  return evaluation
}

export { decisionRecord, parseArguments }

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').at(-1))) await main()
