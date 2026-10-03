export const CONTROL_SCHEMA = 'coldflow.control-pulse-block.v1'
export const DEFAULT_PULSE_SECONDS = 12
export const DEFAULT_STABLE_WINDOW_SECONDS = 5
export const PULSE_DUTY = 0.4

const INITIAL_TEMPERATURES = {
  'normal.v1': [6.5, 6.7, 6.8, 6.4, 6.6, 6.7],
  'obstructed.v1': [10.5, 8.9, 7.4, 6.6, 7.1, 8.5],
  'capacity.v1': [10.5, 8.9, 7.4, 6.6, 7.1, 8.5],
  'fault-matrix.v1': [10.5, 8.9, 7.4, 6.6, 7.1, 8.5],
}

function assertInteger(value, name, minimum = 1) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`Invalid ${name}`)
}

function sourceFor(family) {
  return family === 'capacity.v1' ? 9.4 : 3.5
}

function gainFor(family, zone, actuator) {
  const gains = [
    [0.32, 0.08],
    [0.18, 0.12],
    [0.09, 0.25],
    [0.24, 0.1],
    [0.12, 0.18],
    [0.06, 0.3],
  ]
  const obstruction = family === 'obstructed.v1' && zone === 0 ? 0.08 : 1
  const capacity = family === 'capacity.v1' ? 0.35 : 1
  return gains[zone][actuator] * obstruction * capacity
}

function temperatureAt({ family, seed, blockIndex, second, pulse, intervention }) {
  const initial = INITIAL_TEMPERATURES[family] ?? INITIAL_TEMPERATURES['normal.v1']
  const source = sourceFor(family)
  return initial.map((value, zone) => {
    const seedOffset = (((seed + blockIndex * 13 + zone * 7) % 19) - 9) * 0.002
    const drift = family === 'normal.v1' ? 0 : Math.min(second, 120) * 0.008
    const sourceLoad = (source - 3.5) * 0.015
    const natural = Math.sin((second + zone + seed) / 17) * 0.002
    const pulseEffect = intervention && second >= DEFAULT_STABLE_WINDOW_SECONDS
      ? pulse.reduce((sum, duty, actuator) => sum + duty * gainFor(family, zone, actuator), 0) * (second - DEFAULT_STABLE_WINDOW_SECONDS + 1) * 0.035
      : 0
    return Number((value + seedOffset + drift + sourceLoad + natural - pulseEffect).toFixed(6))
  })
}

function sample({ family, seed, blockIndex, second, pulse, intervention }) {
  const temperaturesC = temperatureAt({ family, seed, blockIndex, second, pulse, intervention })
  return {
    seconds: second,
    measuredAtMs: second * 1000,
    temperaturesC,
    supplyC: sourceFor(family),
    returnAirC: Number((temperaturesC.reduce((sum, value) => sum + value, 0) / temperaturesC.length).toFixed(6)),
    humidity: family === 'fault-matrix.v1' ? 0.55 : 0.5,
  }
}

export function stableWindowGuard(samples, { windowSeconds = DEFAULT_STABLE_WINDOW_SECONDS, maxStepC = 0.05 } = {}) {
  const reasons = []
  if (!Array.isArray(samples) || samples.length < windowSeconds + 1) reasons.push('INSUFFICIENT_STABLE_WINDOW')
  for (let index = 1; index < (samples?.length ?? 0); index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    if (!current?.temperaturesC?.every(Number.isFinite) || !previous?.temperaturesC?.every(Number.isFinite)) reasons.push('NONFINITE_OBSERVATION')
    if (current && previous && current.seconds !== previous.seconds + 1) reasons.push('NONCONTIGUOUS_OBSERVATION')
    if (current && previous && current.temperaturesC.some((value, zone) => Math.abs(value - previous.temperaturesC[zone]) > maxStepC)) reasons.push('TRAJECTORY_NOT_STABLE')
  }
  return { passed: reasons.length === 0, windowSeconds, reasons: [...new Set(reasons)] }
}

export function frozenFeatures(samples, decisionSecond = samples.at(-1)?.seconds ?? 0, windowSeconds = DEFAULT_STABLE_WINDOW_SECONDS) {
  const usable = samples.filter(sample => sample.seconds <= decisionSecond).slice(-(windowSeconds + 1))
  if (usable.length < 2) throw new Error('Cannot freeze features without a complete observation window')
  const temperatures = usable.at(-1).temperaturesC
  const previous = usable.at(-2).temperaturesC
  const meanC = temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length
  return {
    schema: 'coldflow.frozen-features.v1',
    decisionSecond,
    windowStartSecond: usable[0].seconds,
    windowEndSecond: usable.at(-1).seconds,
    meanTemperatureC: Number(meanC.toFixed(6)),
    spreadC: Number((Math.max(...temperatures) - Math.min(...temperatures)).toFixed(6)),
    maxSlopeCPerSecond: Number(Math.max(...temperatures.map((value, index) => Math.abs(value - previous[index]))).toFixed(6)),
    supplyC: usable.at(-1).supplyC,
    featureSourceSamples: usable.length,
    futureSamplesUsed: samples.some(sample => sample.seconds > decisionSecond && usable.includes(sample)),
  }
}

export function createPulseBlock({ family = 'normal.v1', runId = 'run', seed = 2026, blockIndex = 0, startSecond = 0, pulse = [PULSE_DUTY, 0], durationSeconds = DEFAULT_PULSE_SECONDS } = {}) {
  if (!Object.hasOwn(INITIAL_TEMPERATURES, family)) throw new Error(`Unsupported configuration family: ${family}`)
  assertInteger(seed, 'seed')
  assertInteger(blockIndex, 'block index', 0)
  assertInteger(startSecond, 'pulse start', 0)
  assertInteger(durationSeconds, 'pulse duration', 2)
  if (!Array.isArray(pulse) || pulse.length !== 2 || !pulse.every(value => Number.isFinite(value) && value >= 0 && value <= 0.8)) throw new Error('Invalid pulse duty')
  const seconds = Array.from({ length: durationSeconds }, (_, index) => startSecond + index)
  const baseline = seconds.map(second => sample({ family, seed, blockIndex, second, pulse, intervention: false }))
  const intervention = seconds.map(second => sample({ family, seed, blockIndex, second, pulse, intervention: true }))
  const stableWindow = stableWindowGuard(baseline)
  const features = frozenFeatures(baseline, startSecond + DEFAULT_STABLE_WINDOW_SECONDS)
  return {
    schema: CONTROL_SCHEMA,
    family,
    runId,
    seed,
    blockIndex,
    independentBlockId: `${runId}:pulse-${blockIndex}`,
    startSecond,
    endSecond: startSecond + durationSeconds - 1,
    pulse: [...pulse],
    baseline,
    intervention,
    stableWindow,
    frozenFeatures: features,
    noFutureLeakage: !features.futureSamplesUsed && features.windowEndSecond <= startSecond + DEFAULT_STABLE_WINDOW_SECONDS,
  }
}

export function independentPulseBlocks({ family, runId, seed, count = 3, startSpacingSeconds = 30 } = {}) {
  assertInteger(count, 'pulse block count')
  return Array.from({ length: count }, (_, blockIndex) => createPulseBlock({ family, runId, seed, blockIndex, startSecond: blockIndex * startSpacingSeconds }))
}

export function authorityFromPulseBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('At least one pulse block is required')
  const responses = blocks.map(block => block.baseline.at(-1).temperaturesC.map((value, zone) => block.intervention.at(-1).temperaturesC[zone] === undefined ? 0 : value - block.intervention.at(-1).temperaturesC[zone]))
  const cooling = responses[0].map((_, zone) => [
    Number((responses.reduce((sum, response) => sum + response[zone], 0) / blocks.length / blocks[0].pulse[0]).toFixed(6)),
    Number((responses.reduce((sum, response) => sum + response[zone], 0) / blocks.length / Math.max(blocks[0].pulse[1], 0.4)).toFixed(6)),
  ])
  return { cooling, uncertainty: 0.2, pulseCount: blocks.length, horizonSeconds: blocks[0].endSecond - blocks[0].startSecond + 1, source: 'INDEPENDENT_SYNTHETIC_PULSES' }
}
