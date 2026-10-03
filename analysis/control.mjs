import { hashCanonical } from '../recorder/manifest.mjs'
import { configurationForFamily, manifestWithSeed } from '../src/simulator/configuration.ts'
import { observePlant } from '../src/simulator/plant.ts'
import { VirtualDevice } from '../src/simulator/virtual-device.ts'

export const CONTROL_SCHEMA = 'coldflow.control-pulse-block.v1'
export const DEFAULT_PULSE_SECONDS = 12
export const DEFAULT_STABLE_WINDOW_SECONDS = 5
export const PULSE_DUTY = 0.4

const FAMILY_NAMES = new Set(['normal.v1', 'obstructed.v1', 'capacity.v1', 'correctable.v1', 'fault-matrix.v1'])

function assertInteger(value, name, minimum = 1) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`Invalid ${name}`)
}

function canonicalFamilyName(family) {
  if (!FAMILY_NAMES.has(family)) throw new Error(`Unsupported configuration family: ${family}`)
  return family.replace('.v1', '')
}

function outputForHash(result) {
  return {
    accepted: result.accepted,
    applied: result.applied,
    state: result.state,
    reason: result.reason,
    observation: result.observation,
    actuator: result.actuator,
    disturbance: result.disturbance,
    faults: result.faults,
  }
}

function observationSample(result, second) {
  const observation = result.observation
  return {
    seconds: second,
    measuredAtMs: observation.measuredAtMs,
    temperaturesC: [...observation.temperaturesC],
    supplyC: observation.supplyC,
    returnAirC: observation.returnAirC,
    humidity: observation.humidity,
    dewPointC: observation.dewPointC,
    surfaceMinimumC: observation.surfaceMinimumC,
    fanDuty: [...observation.fanDuty],
    fanPowerW: observation.fanPowerW,
    applied: [...result.applied],
    accepted: result.accepted,
    state: result.state,
    reason: result.reason,
    outputHash: hashCanonical(outputForHash(result)),
  }
}

function canonicalSeries({ manifest, startSecond, durationSeconds, pulse }) {
  const device = new VirtualDevice(manifest)
  const samples = []
  const endSecond = startSecond + durationSeconds
  for (let second = 0; second < endSecond; second += 1) {
    const inBlock = second >= startSecond
    const requested = inBlock ? [...pulse] : [0, 0]
    const result = device.tick({
      requested,
      nowMs: second * 1000,
      leaseUntilMs: second * 1000 + 60000,
      sequence: second + 1,
      operatorApproved: true,
      interlockClosed: true,
    })
    if (inBlock) samples.push(observationSample(result, second))
  }
  return { samples, manifestHash: manifest.manifestHash, simulatorVersion: 'cf-sim-v1' }
}

export function pathClearManifest(family, seed) {
  const base = configurationForFamily(canonicalFamilyName(family), seed)
  if (family !== 'obstructed.v1') return base
  const normal = configurationForFamily('normal', seed)
  const pathClearConductance = base.air.actuatorConductance.map((pair, index) => index === 0 ? [...normal.air.actuatorConductance[0]] : [...pair])
  return manifestWithSeed({
    ...base,
    assumptions: [...base.assumptions, 'Matched path-clear intervention changes only the versioned zone-0 actuator authority matrix', 'Initial temperatures, loads, source, and evaluation horizon are held constant for the matched comparison'],
    air: { ...base.air, actuatorConductance: pathClearConductance },
  }, seed)
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

export function createPulseBlock({ family = 'normal.v1', runId = 'run', seed = 2026, blockIndex = 0, startSecond = 0, pulse = blockIndex % 2 === 0 ? [PULSE_DUTY, 0] : [0, PULSE_DUTY], durationSeconds = DEFAULT_PULSE_SECONDS } = {}) {
  canonicalFamilyName(family)
  assertInteger(seed, 'seed')
  assertInteger(blockIndex, 'block index', 0)
  assertInteger(startSecond, 'pulse start', 0)
  assertInteger(durationSeconds, 'pulse duration', 2)
  if (!Array.isArray(pulse) || pulse.length !== 2 || !pulse.every(value => Number.isFinite(value) && value >= 0 && value <= 0.8)) throw new Error('Invalid pulse duty')
  if (pulse[0] > 0 && pulse[1] > 0) throw new Error('Pulse block must isolate one actuator')
  if (pulse.every(value => value === 0)) throw new Error('Pulse block must excite an actuator')
  const manifest = configurationForFamily(canonicalFamilyName(family), seed)
  const baselineRun = canonicalSeries({ manifest, startSecond, durationSeconds, pulse: [0, 0] })
  const interventionRun = canonicalSeries({ manifest, startSecond, durationSeconds, pulse })
  const baseline = baselineRun.samples
  const intervention = interventionRun.samples
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
    excitedActuator: pulse[0] > 0 ? 'A' : 'B',
    baseline,
    intervention,
    stableWindow,
    frozenFeatures: features,
    canonicalSimulator: {
      source: 'VERSIONED_PLANT_VIRTUAL_DEVICE',
      simulatorVersion: 'cf-sim-v1',
      manifestHash: manifest.manifestHash,
      baselineOutputHashes: baseline.map(sample => sample.outputHash),
      interventionOutputHashes: intervention.map(sample => sample.outputHash),
    },
    noFutureLeakage: !features.futureSamplesUsed && features.windowEndSecond <= startSecond + DEFAULT_STABLE_WINDOW_SECONDS,
  }
}

export function independentPulseBlocks({ family, runId, seed, count = 4, startSpacingSeconds = 30 } = {}) {
  assertInteger(count, 'pulse block count')
  return Array.from({ length: count }, (_, blockIndex) => createPulseBlock({ family, runId, seed, blockIndex, startSecond: blockIndex * startSpacingSeconds }))
}

export function authorityFromPulseBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('At least one pulse block is required')
  const columns = [0, 1].map(actuator => {
    const excited = blocks.filter(block => block.pulse[actuator] > 0 && block.pulse[1 - actuator] === 0)
    if (excited.length === 0) throw new Error(`Actuator ${actuator === 0 ? 'A' : 'B'} has no independent excitation`)
    const responses = excited.map(block => {
      if (block.baseline.length !== block.intervention.length) throw new Error('Baseline/intervention lengths differ')
      const pulse = block.pulse[actuator]
      return block.baseline.at(-1).temperaturesC.map((value, zone) => {
        const intervention = block.intervention.at(-1).temperaturesC[zone]
        if (!Number.isFinite(value) || !Number.isFinite(intervention)) throw new Error('Non-finite canonical pulse response')
        return (value - intervention) / pulse
      })
    })
    return responses[0].map((_, zone) => Number((responses.reduce((sum, response) => sum + response[zone], 0) / responses.length).toFixed(6)))
  })
  const cooling = columns[0].map((_, zone) => [columns[0][zone], columns[1][zone]])
  if (cooling.every(row => Math.abs(row[0] - row[1]) < 0.000001)) throw new Error('Independent actuator response columns are duplicated')
  return {
    cooling,
    uncertainty: 0.2,
    pulseCount: blocks.length,
    excitedActuators: [...new Set(blocks.map(block => block.excitedActuator ?? (block.pulse[0] > 0 ? 'A' : 'B')))],
    horizonSeconds: blocks[0].endSecond - blocks[0].startSecond + 1,
    source: 'CANONICAL_VERSIONED_PLANT_VIRTUAL_DEVICE',
  }
}

export function canonicalTrajectory({ family, seed, method, authority, durationSeconds = 30, dutyFor }) {
  const baseManifest = method === 'path-clear' ? pathClearManifest(family, seed) : configurationForFamily(canonicalFamilyName(family), seed)
  const device = new VirtualDevice(baseManifest)
  const trajectory = []
  const actions = []
  const outputHashes = []
  for (let second = 0; second <= durationSeconds; second += 1) {
    const observation = observePlant(device.state)
    const temperatures = [...observation.temperaturesC]
    const duty = dutyFor(method, temperatures, family, authority)
    trajectory.push({ seconds: second, temperaturesC: temperatures.map(value => Number(value.toFixed(6))), supplyC: observation.supplyC, outputHash: second === durationSeconds ? null : undefined })
    actions.push({ second, duty: [...duty] })
    if (second === durationSeconds) break
    const result = device.tick({ requested: [...duty], nowMs: second * 1000, leaseUntilMs: second * 1000 + 60000, sequence: second + 1, operatorApproved: true, interlockClosed: true })
    outputHashes.push(hashCanonical(outputForHash(result)))
    trajectory[trajectory.length - 1].outputHash = outputHashes.at(-1)
  }
  return { trajectory, actions, outputHashes, manifestHash: baseManifest.manifestHash, simulatorVersion: 'cf-sim-v1' }
}
