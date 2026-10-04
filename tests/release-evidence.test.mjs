import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertReleaseManifest, createReleaseManifest, validateReleaseManifest } from '../scripts/create-release-manifest.mjs'

const timestamp = '2026-01-01T00:00:00.000Z'
const hash = 'a'.repeat(64)
const commit = 'b'.repeat(40)
const file = (path = 'artifacts/evidence.json') => ({ path, sha256: hash })
const command = commandName => ({ command: commandName, status: 'passed', exitCode: 0, finishedAt: timestamp })

function validManifest(overrides = {}) {
  const commands = Object.fromEntries(['test', 'lint', 'build', 'evaluation', 'replay', 'sbom', 'docker'].map(name => [name, command(`npm run ${name}`)]))
  const evaluation = { ...file('artifacts/simulation/evaluation.json'), reportHash: hash }
  const manifest = createReleaseManifest({
    generatedAt: timestamp,
    sourceRevision: commit,
    packageLockHash: hash,
    commands,
    evidence: {
      evaluation,
      ml: { decision: file('ml/decision-record.json'), artifact: { ...file('artifacts/ml/candidate.json'), artifactHash: hash } },
      replay: { manifest: file('artifacts/simulation/run.jsonl'), report: file('artifacts/simulation/replay-report.json'), trustedAnchor: file('artifacts/simulation/run.jsonl.anchor.json') },
      sbom: { ...file('artifacts/sbom.json'), serialNumber: 'urn:uuid:test', componentCount: 3, license: { status: 'passed', resultPath: 'artifacts/sbom-check.json', resultHash: hash } },
      image: { reference: 'us-docker.pkg.dev/demo/coldflow@sha256:' + 'c'.repeat(64), digest: 'sha256:' + 'c'.repeat(64), sourceRevision: commit },
      deployment: { service: 'coldflow-simulation', region: 'asia-south1', revision: 'coldflow-simulation-00001-abc', imageReference: 'us-docker.pkg.dev/demo/coldflow@sha256:' + 'c'.repeat(64), imageDigest: 'sha256:' + 'c'.repeat(64), sourceRevision: commit, sourceRevisionLabel: { key: 'coldflow/source-revision', location: 'spec.template.metadata.labels' }, describe: file('artifacts/release/cloud-run-describe.json'), verifiedAt: timestamp, routes: Object.fromEntries(['live', 'ready', 'health', 'metrics', 'experiments'].map(route => [route, { status: 'passed', statusCode: 200, revision: 'coldflow-simulation-00001-abc', verifiedAt: timestamp }])) },
    },
  })
  const merged = { ...manifest, ...overrides, source: { ...manifest.source, ...(overrides.source ?? {}) }, evidence: { ...manifest.evidence, ...(overrides.evidence ?? {}) } }
  return assertReleaseManifest(merged)
}

test('release evidence binds all required identities without a self hash', () => {
  const manifest = validManifest()
  assert.equal(manifest.schema, 'coldflow.release-manifest.v1')
  assert.equal(manifest.source.commit, commit)
  assert.equal('manifestHash' in manifest, false)
  assert.equal(validateReleaseManifest(manifest).valid, true)
})

test('release evidence rejects local or unresolved source and image identities', () => {
  assert.throws(() => validManifest({ source: { commit: 'local' } }), /full commit hash/i)
  const manifest = validManifest()
  manifest.evidence.image.reference = 'coldflow-simulation:local'
  assert.throws(() => assertReleaseManifest(manifest), /local placeholder/i)
  manifest.evidence.image.reference = 'registry/coldflow:release'
  manifest.evidence.image.digest = 'unresolved'
  assert.throws(() => assertReleaseManifest(manifest), /immutable sha256/i)
})

test('release evidence rejects missing hashes and failed license results', () => {
  const manifest = validManifest()
  manifest.evidence.replay.report.sha256 = ''
  manifest.evidence.sbom.license.status = 'failed'
  const result = validateReleaseManifest(manifest)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /trusted|license|hash/i)
})

test('release evidence rejects an image or route identity that is not bound to the deployed revision', () => {
  const imageMismatch = validManifest()
  imageMismatch.evidence.deployment.imageDigest = 'sha256:' + 'd'.repeat(64)
  assert.throws(() => assertReleaseManifest(imageMismatch), /deployment image digest does not match image digest/i)
  const routeMismatch = validManifest()
  routeMismatch.evidence.deployment.routes.live.revision = 'coldflow-simulation-00002-def'
  assert.throws(() => assertReleaseManifest(routeMismatch), /revision must match deployed revision/i)
  const sourceMismatch = validManifest()
  sourceMismatch.evidence.deployment.sourceRevision = 'd'.repeat(40)
  assert.throws(() => assertReleaseManifest(sourceMismatch), /deployment source revision does not match source commit/i)
})

test('release evidence rejects self hashes, mismatched image source, and self inclusion', () => {
  const manifest = validManifest()
  manifest.manifestHash = hash
  assert.throws(() => assertReleaseManifest(manifest), /self hash/i)
  const mismatch = validManifest()
  mismatch.evidence.image.sourceRevision = 'd'.repeat(40)
  assert.throws(() => assertReleaseManifest(mismatch), /does not match source commit/i)
  const selfPath = validManifest()
  selfPath.evidence.evaluation.path = 'artifacts/release/release-manifest.json'
  assert.throws(() => assertReleaseManifest(selfPath, { outputPath: 'artifacts/release/release-manifest.json' }), /include itself/i)
})
