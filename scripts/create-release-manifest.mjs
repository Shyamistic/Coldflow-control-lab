import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { validateDeploymentVerification } from './verify-cloud-run-deployment.mjs'

export const RELEASE_MANIFEST_SCHEMA = 'coldflow.release-manifest.v1'
export const RELEASE_SCHEMA_VERSION = '1.0'
const HASH = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const DIGEST = /^sha256:[a-f0-9]{64}$/
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const COMMANDS = ['test', 'lint', 'build', 'evaluation', 'replay', 'sbom', 'docker']
const ROUTES = ['live', 'ready', 'health', 'metrics', 'experiments']

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function hashFileBytes(bytes) {
  return sha256(bytes)
}

export async function hashFile(path) {
  return hashFileBytes(await readFile(path))
}

function date(value, label) {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO UTC timestamp`)
}

function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new Error(`${label} must be a lowercase SHA-256 hash`)
}

function commit(value, label) {
  if (typeof value !== 'string' || !COMMIT.test(value)) throw new Error(`${label} must be a full commit hash`)
}

function fileEvidence(value, label, errors) {
  if (!value || typeof value !== 'object') return errors.push(`${label} is required`)
  if (typeof value.path !== 'string' || value.path.length === 0) errors.push(`${label}.path is required`)
  try { hash(value.sha256, `${label}.sha256`) } catch (error) { errors.push(error.message) }
}

function knownKeys(value, allowed, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed by the release schema`)
}

export function validateReleaseManifest(manifest, { outputPath = null } = {}) {
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { valid: false, errors: ['manifest must be an object'] }
  if (manifest.schema !== RELEASE_MANIFEST_SCHEMA) errors.push('schema must be coldflow.release-manifest.v1')
  if (manifest.schemaVersion !== RELEASE_SCHEMA_VERSION) errors.push('schemaVersion must be 1.0')
  knownKeys(manifest, ['schema', 'schemaVersion', 'generatedAt', 'source', 'commands', 'evidence'], 'manifest', errors)
  if ('manifestHash' in manifest || 'selfHash' in manifest) errors.push('release manifest must not contain a self hash')
  try { date(manifest.generatedAt, 'generatedAt') } catch (error) { errors.push(error.message) }

  const source = manifest.source
  knownKeys(source, ['commit', 'packageLockHash'], 'source', errors)
  try { commit(source?.commit, 'source.commit') } catch (error) { errors.push(error.message) }
  try { hash(source?.packageLockHash, 'source.packageLockHash') } catch (error) { errors.push(error.message) }

  if (!manifest.commands || typeof manifest.commands !== 'object') errors.push('commands are required')
  else {
    knownKeys(manifest.commands, COMMANDS, 'commands', errors)
    for (const name of COMMANDS) {
    const result = manifest.commands[name]
    knownKeys(result, ['command', 'status', 'exitCode', 'finishedAt'], `commands.${name}`, errors)
    if (!result || result.status !== 'passed' || result.exitCode !== 0 || typeof result.command !== 'string' || !result.command) errors.push(`commands.${name} must be a passed zero-exit command result`)
    else try { date(result.finishedAt, `commands.${name}.finishedAt`) } catch (error) { errors.push(error.message) }
    }
  }

  const evidence = manifest.evidence
  knownKeys(evidence, ['evaluation', 'ml', 'replay', 'sbom', 'image', 'deployment'], 'evidence', errors)
  if (!evidence || typeof evidence !== 'object') errors.push('evidence is required')
  else {
    fileEvidence(evidence.evaluation, 'evidence.evaluation', errors)
    knownKeys(evidence.evaluation, ['path', 'sha256', 'reportHash'], 'evidence.evaluation', errors)
    if (evidence.evaluation?.reportHash !== evidence.evaluation?.sha256) errors.push('evaluation reportHash must match its file hash')
    if (!evidence.ml || typeof evidence.ml !== 'object') errors.push('evidence.ml is required')
    else {
      knownKeys(evidence.ml, ['decision', 'artifact'], 'evidence.ml', errors)
      knownKeys(evidence.ml.decision, ['path', 'sha256'], 'evidence.ml.decision', errors)
      knownKeys(evidence.ml.artifact, ['path', 'sha256', 'artifactHash'], 'evidence.ml.artifact', errors)
      fileEvidence(evidence.ml.decision, 'evidence.ml.decision', errors)
      fileEvidence(evidence.ml.artifact, 'evidence.ml.artifact', errors)
      try { hash(evidence.ml.artifact?.artifactHash, 'evidence.ml.artifact.artifactHash') } catch (error) { errors.push(error.message) }
    }
    if (!evidence.replay || typeof evidence.replay !== 'object') errors.push('evidence.replay is required')
    else {
      knownKeys(evidence.replay, ['manifest', 'report', 'trustedAnchor'], 'evidence.replay', errors)
      for (const name of ['manifest', 'report', 'trustedAnchor']) {
        knownKeys(evidence.replay[name], ['path', 'sha256'], `evidence.replay.${name}`, errors)
        fileEvidence(evidence.replay[name], `evidence.replay.${name}`, errors)
      }
    }
    const sbom = evidence.sbom
    if (!sbom || typeof sbom !== 'object') errors.push('evidence.sbom is required')
    else {
      knownKeys(sbom, ['path', 'sha256', 'serialNumber', 'componentCount', 'license'], 'evidence.sbom', errors)
      knownKeys(sbom.license, ['status', 'resultPath', 'resultHash'], 'evidence.sbom.license', errors)
      fileEvidence(sbom, 'evidence.sbom', errors)
      if (typeof sbom.serialNumber !== 'string' || !sbom.serialNumber) errors.push('evidence.sbom.serialNumber is required')
      if (!Number.isInteger(sbom.componentCount) || sbom.componentCount < 1) errors.push('evidence.sbom.componentCount must be positive')
      if (sbom.license?.status !== 'passed') errors.push('evidence.sbom.license.status must be passed')
      if (typeof sbom.license?.resultPath !== 'string' || !sbom.license.resultPath) errors.push('evidence.sbom.license.resultPath is required')
      try { hash(sbom.license?.resultHash, 'evidence.sbom.license.resultHash') } catch (error) { errors.push(error.message) }
    }
    const image = evidence.image
    if (!image || typeof image !== 'object') errors.push('evidence.image is required')
    else {
      knownKeys(image, ['reference', 'digest', 'sourceRevision'], 'evidence.image', errors)
      if (typeof image.reference !== 'string' || !image.reference || /(?:^|:)(?:local|unbuilt|unresolved)(?:$|:)/i.test(image.reference)) errors.push('image.reference must identify a released image, not a local placeholder')
      if (!DIGEST.test(image.digest ?? '')) errors.push('image.digest must be an immutable sha256 digest')
      try { commit(image.sourceRevision, 'image.sourceRevision') } catch (error) { errors.push(error.message) }
      if (image.sourceRevision !== source?.commit) errors.push('image source revision does not match source commit')
    }
    const deployment = evidence.deployment
    if (!deployment || typeof deployment !== 'object') errors.push('evidence.deployment is required')
    else {
      knownKeys(deployment, ['service', 'region', 'revision', 'imageReference', 'imageDigest', 'sourceRevision', 'sourceRevisionLabel', 'describe', 'verifiedAt', 'routes'], 'evidence.deployment', errors)
      knownKeys(deployment.routes, ROUTES, 'evidence.deployment.routes', errors)
      for (const [name, value] of [['service', deployment.service], ['region', deployment.region], ['revision', deployment.revision], ['imageReference', deployment.imageReference]]) if (typeof value !== 'string' || !value || /placeholder|project[_-]?id|unresolved|local/i.test(value)) errors.push(`deployment.${name} must be resolved`)
      if (!DIGEST.test(deployment.imageDigest ?? '')) errors.push('deployment.imageDigest must be an immutable sha256 digest')
      if (deployment.imageDigest !== image?.digest) errors.push('deployment image digest does not match image digest')
      try { commit(deployment.sourceRevision, 'deployment.sourceRevision') } catch (error) { errors.push(error.message) }
      if (deployment.sourceRevision !== source?.commit) errors.push('deployment source revision does not match source commit')
      if (!deployment.sourceRevisionLabel || typeof deployment.sourceRevisionLabel !== 'object' || typeof deployment.sourceRevisionLabel.key !== 'string' || typeof deployment.sourceRevisionLabel.location !== 'string') errors.push('deployment.sourceRevisionLabel must identify the resolved source metadata')
      knownKeys(deployment.sourceRevisionLabel, ['key', 'location'], 'evidence.deployment.sourceRevisionLabel', errors)
      knownKeys(deployment.describe, ['path', 'sha256'], 'evidence.deployment.describe', errors)
      fileEvidence(deployment.describe, 'evidence.deployment.describe', errors)
      try { date(deployment.verifiedAt, 'deployment.verifiedAt') } catch (error) { errors.push(error.message) }
      for (const route of ROUTES) {
        const check = deployment.routes?.[route]
        knownKeys(check, ['status', 'statusCode', 'revision', 'verifiedAt', 'url'], `evidence.deployment.routes.${route}`, errors)
        if (!check || check.status !== 'passed' || !Number.isInteger(check.statusCode) || check.statusCode < 200 || check.statusCode > 299) errors.push(`deployment.routes.${route} must be a passed 2xx check`)
        else {
          if (check.revision !== deployment.revision) errors.push(`deployment.routes.${route}.revision must match deployed revision`)
          try { date(check.verifiedAt, `deployment.routes.${route}.verifiedAt`) } catch (error) { errors.push(error.message) }
        }
      }
    }
  }

  if (outputPath) {
    const target = resolve(outputPath)
    const paths = []
    const collect = value => {
      if (!value || typeof value !== 'object') return
      for (const [key, item] of Object.entries(value)) {
        if (key === 'path' || key === 'resultPath') paths.push(item)
        else collect(item)
      }
    }
    collect(manifest)
    if (paths.some(path => resolve(path) === target)) errors.push('release manifest cannot include itself as evidence')
  }
  return { valid: errors.length === 0, errors }
}

export function assertReleaseManifest(manifest, options = {}) {
  const result = validateReleaseManifest(manifest, options)
  if (!result.valid) throw new Error(`Invalid release manifest: ${result.errors.join('; ')}`)
  return manifest
}

export function createReleaseManifest(input, options = {}) {
  const manifest = {
    schema: RELEASE_MANIFEST_SCHEMA,
    schemaVersion: RELEASE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: { commit: input.sourceRevision, packageLockHash: input.packageLockHash },
    commands: input.commands,
    evidence: input.evidence,
  }
  return assertReleaseManifest(manifest, options)
}

function parseFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue
    const [key, inline] = argv[index].slice(2).split('=', 2)
    flags[key] = inline ?? argv[++index]
  }
  return flags
}

async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function evidence(path) { return { path, sha256: await hashFile(path) } }
function gitHead() { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
function ensureCommitExists(value) { commit(value, 'source commit'); execFileSync('git', ['cat-file', '-e', `${value}^{commit}`], { stdio: 'ignore' }) }

export async function main(argv = process.argv.slice(2)) {
  const flags = parseFlags(argv)
  const output = flags.output ?? 'artifacts/release/release-manifest.json'
  if (!output.split(/[\\/]/).includes('artifacts')) throw new Error('release manifest output must remain under ignored artifacts/')
  const sourceRevision = flags['source-commit'] ?? gitHead()
  ensureCommitExists(sourceRevision)
  const commandResults = await json(flags.commands ?? 'artifacts/release/command-results.json')
  const sbom = await json(flags.sbom ?? 'artifacts/sbom.json')
  const licenseResultPath = flags['license-result'] ?? 'artifacts/sbom-check.json'
  const licenseResult = await json(licenseResultPath)
  if (licenseResult.checked !== true) throw new Error('SBOM license result is not a passing checked result')
  const model = await json(flags['model-artifact'] ?? 'artifacts/ml/candidate.json')
  const deploymentVerificationPath = flags['deployment-verification'] ?? flags['deployment-checks'] ?? 'artifacts/release/deployment-checks.json'
  const deploymentVerification = await json(deploymentVerificationPath)
  const imageSourceRevision = flags['image-source-commit'] ?? sourceRevision
  if (imageSourceRevision !== sourceRevision) throw new Error('--image-source-commit must match --source-commit')
  const imageDigest = flags['image-digest']
  if (!imageDigest) throw new Error('--image-digest is required to bind the built image')
  const cloudRunService = flags['cloud-run-service']
  const cloudRunRegion = flags['cloud-run-region']
  if (!cloudRunService || !cloudRunRegion) throw new Error('--cloud-run-service and --cloud-run-region are required')
  const deploymentCheck = validateDeploymentVerification(deploymentVerification, { service: cloudRunService, region: cloudRunRegion, sourceRevision, imageDigest, revision: flags['cloud-run-revision'] })
  if (!deploymentCheck.valid) throw new Error(`Invalid deployment verification: ${deploymentCheck.errors.join('; ')}`)
  const manifest = createReleaseManifest({
    sourceRevision,
    packageLockHash: await hashFile(flags['package-lock'] ?? 'package-lock.json'),
    commands: commandResults,
    evidence: {
      evaluation: { ...(await evidence(flags.evaluation ?? 'artifacts/simulation/evaluation.json')), reportHash: await hashFile(flags.evaluation ?? 'artifacts/simulation/evaluation.json') },
      ml: { decision: await evidence(flags['model-decision'] ?? 'ml/decision-record.json'), artifact: { ...(await evidence(flags['model-artifact'] ?? 'artifacts/ml/candidate.json')), artifactHash: model.artifactHash } },
      replay: { manifest: await evidence(flags['replay-manifest'] ?? 'artifacts/simulation/run.jsonl'), report: await evidence(flags['replay-report'] ?? 'artifacts/simulation/replay-report.json'), trustedAnchor: await evidence(flags['trusted-anchor'] ?? 'artifacts/simulation/run.jsonl.anchor.json') },
      sbom: { ...(await evidence(flags.sbom ?? 'artifacts/sbom.json')), serialNumber: sbom.serialNumber, componentCount: sbom.components?.length ?? 0, license: { status: 'passed', resultPath: licenseResultPath, resultHash: await hashFile(licenseResultPath) } },
      image: { reference: flags['image-reference'] ?? deploymentVerification.imageReference, digest: imageDigest, sourceRevision: imageSourceRevision },
      deployment: deploymentVerification,
    },
  }, { outputPath: output })
  await mkdir(dirname(resolve(output)), { recursive: true })
  await writeFile(resolve(output), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output, sourceRevision, imageDigest: manifest.evidence.image.digest, deployedRevision: manifest.evidence.deployment.revision, service: manifest.evidence.deployment.service, region: manifest.evidence.deployment.region, schema: manifest.schema }))
  return manifest
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').at(-1))) await main()
