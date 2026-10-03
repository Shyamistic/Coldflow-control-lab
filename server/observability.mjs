import { randomUUID } from 'node:crypto'

const counters = new Map([
  ['coldflow_replay_total', 0],
  ['coldflow_fault_total', 0],
  ['coldflow_abstention_total', 0],
  ['coldflow_expiry_total', 0],
  ['coldflow_advisory_total', 0],
  ['coldflow_model_total', 0],
])
const durations = { count: 0, totalMs: 0, maxMs: 0 }
const allowedCorrelation = /^[A-Za-z0-9._:-]{1,96}$/

function increment(name) {
  counters.set(name, (counters.get(name) ?? 0) + 1)
}

export function createObservability({ logger = console } = {}) {
  const provenance = Object.freeze({
    evidenceClass: 'SIMULATION',
    executionClass: 'SIMULATED',
    service: 'coldflow-simulation',
    config: process.env.SIMULATION_CONFIG_VERSION || 'default-v1',
  })

  function correlationId(requested) {
    return typeof requested === 'string' && allowedCorrelation.test(requested) ? requested : randomUUID()
  }

  function record(event, fields = {}) {
    increment(`coldflow_${event}_total`)
    logger.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ...provenance, ...fields }))
  }

  function middleware(req, res, next) {
    const started = performance.now()
    const id = correlationId(req.get('x-correlation-id'))
    req.correlationId = id
    res.set('X-Correlation-ID', id)
    res.on('finish', () => {
      const durationMs = Number((performance.now() - started).toFixed(2))
      durations.count += 1
      durations.totalMs += durationMs
      durations.maxMs = Math.max(durations.maxMs, durationMs)
      increment('coldflow_requests_total')
      increment(`coldflow_http_${res.statusCode}_total`)
      if (res.statusCode >= 400) increment('coldflow_errors_total')
      logger.info(JSON.stringify({ timestamp: new Date().toISOString(), event: 'request.completed', ...provenance, correlationId: id, method: req.method, path: req.path, status: res.statusCode, durationMs }))
    })
    next()
  }

  function metric(name, fields = {}) {
    record(name, { ...fields })
  }

  function snapshot() {
    return { counters: Object.fromEntries(counters), requests: { ...durations } }
  }

  function metricsText() {
    const lines = ['# HELP coldflow_info Simulation service metadata', '# TYPE coldflow_info gauge', 'coldflow_info{evidence_class="SIMULATION",execution_class="SIMULATED"} 1']
    for (const [name, value] of counters) lines.push(`# TYPE ${name} counter\n${name} ${value}`)
    lines.push(`# TYPE coldflow_request_duration_ms gauge\ncoldflow_request_duration_ms ${durations.count ? (durations.totalMs / durations.count).toFixed(2) : '0'}`)
    return `${lines.join('\n')}\n`
  }

  return { middleware, metric, snapshot, metricsText, provenance }
}
