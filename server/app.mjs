import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { SCENARIOS, runCanonicalExperiment } from '../src/simulator/public-experiment.ts'
import { createObservability } from './observability.mjs'

const scenario = z.enum(['partial', 'blocked', 'capacity', 'sensor', 'actuator', 'normal', 'correctable'])
const method = z.enum(['identified', 'fixed-normal', 'fixed-high', 'expert-rule', 'path-clear'])
const requestSchema = z.object({ scenario, method, duration: z.number().int().min(1).max(600).default(600), seed: z.number().int().min(1).max(100000).default(2026) }).strict()
const explanationSchema = z.object({ scenario, method, frame: z.number().int().min(0).max(120).default(0) }).strict()

export function createApp({ serveStatic = true, logger = console } = {}) {
  const app = express()
  const observability = createObservability({ logger })
  const eventProvenance = (req, result, { scenario: selected, method: comparator, duration = 600, seed = 2026 } = {}) => {
    const runId = `api-${selected}-${comparator}-${seed}-${createHash('sha256').update(JSON.stringify({ selected, comparator, duration, seed })).digest('hex').slice(0, 12)}`
    return observability.requestContext(req, { evidenceClass: 'SIMULATION', executionClass: result.provenance.executionClass, simulatorVersion: result.provenance.simulatorVersion, executionPath: result.provenance.executionPath, configurationFamily: `${result.provenance.configurationFamily}.v1`, configHash: result.provenance.manifestHash, outputHash: result.provenance.outputHash, runId, seed })
  }
  app.disable('x-powered-by')
  app.use(observability.middleware)
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'" })
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store')
    next()
  })
  app.use('/api', rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Request limit reached. Retry later.' } }))
  app.use(express.json({ limit: '8kb' }))
  app.get('/api/live', (_req, res) => res.json({ status: 'ok', service: 'coldflow-simulation' }))
  app.get('/api/ready', (_req, res) => res.json({ status: 'ready', evidenceClass: 'SIMULATION', executionClass: 'SIMULATED', hardwareConnected: false, physicalGatesPassed: [], actuatorAuthority: false }))
  app.get('/api/metrics', (_req, res) => { res.type('text/plain').send(observability.metricsText()) })
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '0.1.0', evidenceClass: 'SIMULATION', hardwareConnected: false, vertexEnabled: process.env.ENABLE_VERTEX === 'true', physicalGatesPassed: [] }))
  app.post('/api/experiments', (req, res) => {
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) { observability.metric('validation_failure', observability.requestContext(req, { operation: 'experiment' })); return res.status(400).json({ error: 'Invalid experiment request', issues: parsed.error.issues }) }
    const result = runCanonicalExperiment(parsed.data.scenario, parsed.data.method, parsed.data.duration, parsed.data.seed)
    const provenance = eventProvenance(req, result, parsed.data)
    observability.metric('simulation_run', { operation: 'experiment', scenario: parsed.data.scenario, ...provenance })
    if (result.samples.some(sample => sample.state === 'ABSTAIN')) observability.metric('abstention', { ...provenance })
    if (!['normal', 'correctable'].includes(parsed.data.scenario)) observability.metric('fault', { scenario: parsed.data.scenario, ...provenance })
    const serialized = JSON.stringify(result)
    res.json({ experiment: result, sha256: createHash('sha256').update(serialized).digest('hex'), hashEncoding: 'UTF-8 JSON.stringify(experiment); exact property order' })
  })
  app.post('/api/explain', (req, res) => {
    const parsed = explanationSchema.safeParse(req.body)
    if (!parsed.success) { observability.metric('validation_failure', observability.requestContext(req, { operation: 'explain' })); return res.status(400).json({ error: 'Invalid explanation request' }) }
    const { scenario: selected, method: comparator, frame } = parsed.data
    const result = runCanonicalExperiment(selected, comparator)
    const sample = result.samples[frame] ?? result.samples.at(-1)
    const provenance = eventProvenance(req, result, { scenario: selected, method: comparator })
    observability.metric('advisory', { operation: 'deterministic_explain', ...provenance })
    if (sample.state === 'ABSTAIN') observability.metric('abstention', { operation: 'explain', ...provenance })
    res.json({ provider: 'deterministic', evidenceClass: 'SIMULATION', provenance: result.provenance, text: `${SCENARIOS[selected].name}: ${SCENARIOS[selected].description}\nAt ${sample.seconds}s model time: ${sample.state}; ${sample.reason}. Maximum zone-air temperature ${Math.max(...sample.temperatures).toFixed(2)} C; modeled added-fan energy ${sample.fanWh.toFixed(3)} Wh.\nThese are synthetic coefficients and cloned calibration. No physical gate, food outcome or refrigeration savings are established. No-response alone cannot diagnose restacking.` })
  })
  app.post('/api/vertex-explain', async (req, res) => {
    if (process.env.ENABLE_VERTEX !== 'true' || !process.env.EXPLANATION_TOKEN) { observability.metric('vertex_disabled', observability.requestContext(req, { operation: 'vertex_explain' })); return res.status(503).json({ error: 'Vertex disabled; deterministic interpretation is available.' }) }
    const authorization = req.headers.authorization ?? ''
    const { timingSafeEqual } = await import('node:crypto')
    const supplied = Buffer.from(authorization)
    const expected = Buffer.from(`Bearer ${process.env.EXPLANATION_TOKEN}`)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'Authorized operator token required.' })
    const parsed = explanationSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid explanation request' })
    const canonical = runCanonicalExperiment(parsed.data.scenario, parsed.data.method)
    const provenance = eventProvenance(req, canonical, parsed.data)
    try {
      const { GoogleGenAI } = await import('@google/genai')
      const client = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION || 'global' })
      const sample = canonical.samples[parsed.data.frame] ?? canonical.samples.at(-1)
      const response = await client.models.generateContent({ model: process.env.VERTEX_MODEL || 'gemini-2.5-flash', contents: `Interpret this synthetic ColdFlow sample in under 100 words: ${JSON.stringify(sample)}`, config: { maxOutputTokens: 220, temperature: 0, httpOptions: { timeout: 15000 }, systemInstruction: 'You explain SIMULATION ONLY. Never prescribe or issue actuator commands. No measured hardware evidence, food core, safety certification, spoilage prevention or net refrigeration saving is established. No-response does not prove blockage or restacking. Coefficients, calibration and uncertainty are synthetic assumptions. Do not invent outcomes. Always include SIMULATION ONLY.' } })
      res.json({ provider: 'vertex', evidenceClass: 'SIMULATION', provenance: canonical.provenance, text: `SIMULATION ONLY - AI interpretation, no control authority.\n${response.text || 'No explanation returned.'}` })
      observability.metric('advisory', { operation: 'vertex_explain', ...provenance })
    } catch { observability.metric('error', { operation: 'vertex_explain', ...provenance }); res.status(502).json({ error: 'Vertex unavailable. Use deterministic interpretation.' }) }
  })
  app.use('/api', (_req, res) => res.status(404).json({ error: 'No such API route. No physical actuator interface exists.' }))
  if (serveStatic) {
    const root = resolve(import.meta.dirname, '../dist')
    app.use(express.static(root, { maxAge: '1h', index: false }))
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'index.html')))
  }
  app.use((error, _req, res, _next) => { res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Request could not be processed.' }) })
  return app
}