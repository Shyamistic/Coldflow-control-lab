import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.mjs'
let server, base
before(async () => { server = createApp({ serveStatic: false }).listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}` })
after(() => new Promise(resolve => server.close(resolve)))
const post = (path, data) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
test('health explicitly identifies nonhardware simulation', async () => { const response = await fetch(`${base}/api/health`); const body = await response.json(); assert.equal(body.hardwareConnected, false); assert.deepEqual(body.physicalGatesPassed, []); assert.equal(response.headers.get('x-frame-options'), 'DENY') })
test('experiment export hash matches exact returned data', async () => { const response = await post('/api/experiments', { scenario: 'partial', method: 'identified', duration: 10 }); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.sha256, createHash('sha256').update(JSON.stringify(body.experiment)).digest('hex')); assert.equal(body.experiment.evidenceClass, 'SIMULATION') })
test('unknown fields and excessive workloads rejected', async () => { for (const data of [{ scenario: 'partial', method: 'identified', duration: 601 }, { scenario: 'invalid', method: 'identified' }, { scenario: 'partial', method: 'identified', pwm: 1 }]) assert.equal((await post('/api/experiments', data)).status, 400) })
test('no physical command interface exists', async () => { assert.equal((await post('/api/commands', { pwm: 1 })).status, 404) })
test('deterministic explanation requires no AI and preserves evidence boundaries', async () => { const response = await post('/api/explain', { scenario: 'blocked', method: 'identified', frame: 1 }); const body = await response.json(); assert.equal(body.provider, 'deterministic'); assert.match(body.text, /cannot diagnose restacking/); assert.match(body.text, /ABSTAIN/) })
test('public service does not enable billable Vertex', async () => { const response = await post('/api/vertex-explain', { scenario: 'partial', method: 'identified', frame: 1 }); assert.equal(response.status, 503) })