import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { FEATURE_NAMES, FEATURE_SCHEMA, leaveOneFamilyOut, manifestHash, rowsFromEvaluation, sha256, vectorFromFeatures } from './features.mjs'

export const MODEL_SCHEMA = 'coldflow.advisory-model.v1'
export const MODEL_VERSION = 'nearest-centroid-v1'
export const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z'

function parseList(value, fallback, numeric = false) {
  const items = value ? value.split(',').map(item => item.trim()).filter(Boolean) : fallback
  return numeric ? items.map(Number) : items
}

export function parseTrainingArguments(argumentsList = process.argv.slice(2)) {
  const values = {}
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (!argument.startsWith('--')) continue
    const [key, inline] = argument.slice(2).split('=', 2)
    values[key] = inline ?? argumentsList[index + 1]
    if (inline === undefined) index += 1
  }
  return {
    families: parseList(values.families, ['normal.v1', 'obstructed.v1', 'capacity.v1']),
    seeds: parseList(values.seeds, ['101', '202', '303', '404'], true),
    report: values.report ?? 'artifacts/simulation/evaluation.json',
    output: values.output ?? 'artifacts/ml/candidate.json',
  }
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardScales(rows) {
  return FEATURE_NAMES.map((_, index) => {
    const values = rows.map(row => vectorFromFeatures(row)[index])
    const center = mean(values)
    const variance = mean(values.map(value => (value - center) ** 2))
    return Math.max(Math.sqrt(variance), 0.000001)
  })
}

function centroid(rows, label) {
  const selected = rows.filter(row => row.label === label)
  return FEATURE_NAMES.map((_, index) => mean(selected.map(row => vectorFromFeatures(row)[index])))
}

export function trainFold({ holdoutFamily, train, holdout }) {
  const labels = [...new Set(train.map(row => row.label))].sort()
  const scales = standardScales(train)
  const centroids = Object.fromEntries(labels.map(label => [label, centroid(train, label)]))
  const trainingDistances = train.map(row => {
    const values = vectorFromFeatures(row)
    return Math.min(...labels.map(label => Math.sqrt(values.reduce((sum, value, index) => sum + ((value - centroids[label][index]) / scales[index]) ** 2, 0))))
  })
  const maxTrainingDistance = Math.max(...trainingDistances, 0)
  return {
    holdoutFamily,
    algorithm: MODEL_VERSION,
    featureNames: FEATURE_NAMES,
    labels,
    scales,
    centroids,
    oodThreshold: Number(Math.max(1.5, maxTrainingDistance * 1.25 + 0.25).toFixed(6)),
    trainGroups: train.map(row => row.groupId).sort(),
    holdoutGroups: holdout.map(row => row.groupId).sort(),
  }
}

export function trainCandidate(report, options) {
  const rows = rowsFromEvaluation(report, options)
  const folds = leaveOneFamilyOut(rows).map(fold => trainFold(fold))
  const manifest = { schema: FEATURE_SCHEMA, featureNames: FEATURE_NAMES, rows }
  const withoutHash = {
    schema: MODEL_SCHEMA,
    schemaVersion: '1.0',
    modelVersion: MODEL_VERSION,
    generatedAt: FIXED_GENERATED_AT,
    provenance: {
      evidenceClass: 'SIMULATED',
      source: 'FEAT-005_NO_ML_EVALUATION',
      simulatorVersion: report.provenance.simulatorVersion,
      physicalHardwareAssembled: false,
      directActuatorWrite: false,
      modelAdvisoryOnly: true,
    },
    input: {
      evaluationSchema: report.schema,
      evaluationReportHash: options.reportHash,
      featureManifestHash: manifestHash(rows),
      families: [...options.families].sort(),
      seeds: [...options.seeds].sort((a, b) => a - b),
    },
    featureSchema: FEATURE_SCHEMA,
    featureNames: FEATURE_NAMES,
    algorithm: { name: MODEL_VERSION, class: 'shallow-nearest-centroid', dependency: 'node-standard-library-only' },
    grouping: {
      unit: 'configuration-family/run/seed',
      split: 'leave-one-family-out',
      temporalLeakage: false,
      groupOverlap: false,
      folds: folds.map(fold => ({ holdoutFamily: fold.holdoutFamily, trainGroups: fold.trainGroups, holdoutGroups: fold.holdoutGroups })),
    },
    manifest,
    folds,
    safety: { advisoryOnly: true, directActuatorWrite: false, safeOutput: [0, 0], shieldAuthoritative: true },
  }
  return { ...withoutHash, artifactHash: sha256(withoutHash) }
}

export function renderModelCard(model, evaluation = null) {
  const metrics = evaluation?.metrics
  return `# ColdFlow advisory model card\n\n- **Model:** \`${model.modelVersion}\`\n- **Artifact schema:** \`${model.schema}\`\n- **Evidence:** SIMULATED synthetic simulator output only\n- **Generated:** ${model.generatedAt}\n- **Artifact hash:** \`${model.artifactHash}\`\n- **Feature manifest hash:** \`${model.input.featureManifestHash}\`\n- **Source report hash:** \`${model.input.evaluationReportHash}\`\n\n## Intended use\nThis is an optional, shallow advisory classifier for simulation review. It emits a label, reason, confidence and abstention signal; it does not produce a fan command, setpoint, lease, interlock decision or actuator write. The deterministic ColdFlow shield, virtual-device expiry rules and future firmware policy remain authoritative.\n\n## Training and evaluation\nTraining uses only the versioned FEAT-005 report and frozen pre-decision features: ${model.featureNames.join(', ')}. It uses standard-library arithmetic and a nearest-centroid model with deterministic leave-one-configuration-family-out grouped folds. Entire family/run/seed groups are kept together. Future, post-intervention, actuator and outcome fields are excluded from the feature vector.\n\n${metrics ? `The held-out evaluation reported **${metrics.total}** rows, **${metrics.abstained}** abstentions, **${metrics.accuracy}** accuracy among all rows, **${metrics.falseCorrectable.count}** false-correctable predictions, and **${metrics.ood.detected}/${metrics.ood.total}** synthetic OOD detections. The selection result is **${evaluation.selection.decision}**.\n` : 'Run `node ml/evaluate.mjs --model artifacts/ml/candidate.json --output artifacts/ml/evaluation.json` to produce held-out metrics and the selection record.\n'}\n## Limitations and transfer\nAll labels and measurements are synthetic rules from the current simulator. The artifact is not calibrated against hardware, product core, food quality, refrigerant behavior, airflow instrumentation or field conditions. Seeds and repeated simulator windows are not independent physical evidence. Leave-one-family-out performance is an OOD/transfer probe, not proof of an unseen room or recipe. A later physical workflow must freeze labels, calibration, meaningful margins, independence, failure handling and human approval before any deployment decision.\n\n## Selection boundary\nThe declared gate requires a held-out utility improvement of at least 0.05 with no increase in false-correctable risk or unsafe-authorization risk. If that gate is not met, the removable fallback is **NO_ML_BASELINE**.\n`
}

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseTrainingArguments(argumentsList)
  const reportText = await readFile(resolve(options.report), 'utf8')
  const report = JSON.parse(reportText)
  const model = trainCandidate(report, { ...options, reportHash: sha256(reportText) })
  await mkdir(dirname(resolve(options.output)), { recursive: true })
  await writeFile(resolve(options.output), `${JSON.stringify(model, null, 2)}\n`, 'utf8')
  await mkdir('ml', { recursive: true })
  await writeFile('ml/model-card.md', renderModelCard(model), 'utf8')
  process.stdout.write(`Wrote ${options.output}: ${model.folds.length} grouped folds, ${model.manifest.rows.length} rows, hash ${model.artifactHash}\n`)
  return model
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').at(-1))) await main()
