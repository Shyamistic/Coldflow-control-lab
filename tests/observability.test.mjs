import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/app.mjs'

let server
let base
const logs = []

test.before(async () => {
  server = createApp({ serveStatic: false, logger: { info: line => logs.push(JSON.parse(line)) } }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
test.after(() => new Promise(resolve => server.close(resolve)))

test('liveness, readiness, and health expose separate simulation claims', async () => {
  const [live, ready, health] = await Promise.all(['live', 'ready', 'health'].map(path => fetch(`${base}/api/${path}`)))
  assert.equal(live.status, 200)
  assert.equal(ready.status, 200)
  assert.equal((await ready.json()).hardwareConnected, false)
  assert.equal((await health.json()).status, 'ok')
})

test('correlation IDs and bounded metrics are emitted without credentials', async () => {
  const response = await fetch(`${base}/api/health`, { headers: { 'x-correlation-id': 'test-run-1' } })
  assert.equal(response.headers.get('x-correlation-id'), 'test-run-1')
  const experiment = await fetch(`${base}/api/experiments`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'test-run-2' }, body: JSON.stringify({ scenario: 'partial', method: 'identified', duration: 2, seed: 101 }) })
  assert.equal(experiment.status, 200)
  const explanation = await fetch(`${base}/api/explain`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': 'test-run-3' }, body: JSON.stringify({ scenario: 'blocked', method: 'identified', frame: 1 }) })
  assert.equal(explanation.status, 200)
  const metrics = await (await fetch(`${base}/api/metrics`)).text()
  assert.match(metrics, /coldflow_requests_total/)
  assert.equal(logs.find(entry => entry.correlationId === 'test-run-1')?.correlationId, 'test-run-1')
  for (const event of logs.filter(entry => ['simulation_run', 'fault', 'advisory'].includes(entry.event))) {
    assert.ok(event.correlationId)
    assert.ok(event.runId)
    assert.ok(Number.isInteger(event.seed))
    assert.ok(event.configHash)
  }
  assert.equal(JSON.stringify(logs).includes('EXPLANATION_TOKEN'), false)
})
