import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveCloudRunDeployment, validateDeploymentVerification } from '../scripts/verify-cloud-run-deployment.mjs'

const timestamp = '2026-01-01T00:00:00.000Z'
const sourceRevision = 'b'.repeat(40)
const imageDigest = 'sha256:' + 'c'.repeat(64)
const revision = 'coldflow-simulation-00042-xyz'
const routes = Object.fromEntries(['live', 'ready', 'health', 'metrics', 'experiments'].map(route => [route, { status: 'passed', statusCode: 200, revision, verifiedAt: timestamp }]))
const describe = {
  metadata: { name: 'coldflow-simulation' },
  spec: {
    template: {
      metadata: { labels: { 'coldflow/source-revision': sourceRevision } },
      spec: { containers: [{ image: `us-docker.pkg.dev/demo/coldflow@${imageDigest}` }] },
    },
  },
  status: { latestReadyRevisionName: revision, traffic: [{ percent: 100, revisionName: revision }] },
}

function validVerification() {
  return resolveCloudRunDeployment(describe, { service: 'coldflow-simulation', region: 'asia-south1', sourceRevision, imageDigest, describePath: 'artifacts/release/cloud-run-describe.json', describeHash: 'a'.repeat(64), verifiedAt: timestamp, routes })
}

test('Cloud Run verification records the actual revision, digest, source label and route binding', () => {
  const verification = validVerification()
  assert.equal(verification.revision, revision)
  assert.equal(verification.imageDigest, imageDigest)
  assert.equal(verification.sourceRevision, sourceRevision)
  assert.deepEqual(verification.sourceRevisionLabel, { key: 'coldflow/source-revision', location: 'spec.template.metadata.labels' })
  assert.equal(verification.region, 'asia-south1')
  assert.equal(verification.routes.live.revision, revision)
  assert.equal(validateDeploymentVerification(verification, { service: 'coldflow-simulation', region: 'asia-south1', sourceRevision, imageDigest }).valid, true)
})

test('Cloud Run verification rejects a deployed image digest mismatch', () => {
  assert.throws(() => resolveCloudRunDeployment(describe, { service: 'coldflow-simulation', region: 'asia-south1', sourceRevision, imageDigest: 'sha256:' + 'd'.repeat(64), describePath: 'describe.json', describeHash: 'a'.repeat(64), routes }), /deployed image digest does not match built image digest/i)
})

test('Cloud Run verification rejects source metadata and route revision mismatches', () => {
  const sourceMismatch = structuredClone(describe)
  sourceMismatch.spec.template.metadata.labels['coldflow/source-revision'] = 'd'.repeat(40)
  assert.throws(() => resolveCloudRunDeployment(sourceMismatch, { service: 'coldflow-simulation', region: 'asia-south1', sourceRevision, imageDigest, describePath: 'describe.json', describeHash: 'a'.repeat(64), routes }), /source revision label does not match/i)
  const routeMismatch = { ...routes, live: { ...routes.live, revision: 'coldflow-simulation-00041-old' } }
  assert.throws(() => resolveCloudRunDeployment(describe, { service: 'coldflow-simulation', region: 'asia-south1', sourceRevision, imageDigest, describePath: 'describe.json', describeHash: 'a'.repeat(64), routes: routeMismatch }), /routes\.live\.revision does not match/i)
})
