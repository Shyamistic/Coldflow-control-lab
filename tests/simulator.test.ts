import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONFIGURATION_FAMILIES, configurationForFamily } from '../src/simulator/configuration.ts'
import { activeFaults, faultMatrix } from '../src/simulator/faults.ts'
import { createPlant, observePlant, stepPlant } from '../src/simulator/plant.ts'
import { replayFamily } from '../src/simulator/virtual-device.ts'

test('every configuration family has versioned assumptions, hashes and finite bounded trajectories', () => {
  for (const family of Object.keys(CONFIGURATION_FAMILIES) as (keyof typeof CONFIGURATION_FAMILIES)[]) {
    const manifest = configurationForFamily(family)
    assert.match(manifest.manifestHash, /^fnv1a4:[0-9a-f]{32}$/)
    assert.equal(manifest.version, 'cf-sim-config-v1')
    assert.ok(manifest.assumptions.length > 0)
    let plant = createPlant(manifest)
    for (let second = 0; second < 120; second += 1) {
      const faults = activeFaults(manifest.faults, plant.seconds)
      const disturbance = { sourceTemperatureC: manifest.source.temperatureC, doorOpen: manifest.door.open || faults.doorOpen, defrost: manifest.defrost.active || faults.defrost, humidity: manifest.humidity.relativeHumidity, condensationRisk: manifest.condensation.wet || faults.condensationRisk }
      plant = stepPlant(plant, [0.4, 0.4], disturbance, faults)
    }
    assert.ok(plant.airC.every(value => Number.isFinite(value) && value >= -20 && value <= 50))
    assert.ok(Number.isFinite(plant.fanEnergyWh) && plant.fanEnergyWh >= 0)
    const observation = observePlant(plant)
    assert.equal(observation.temperaturesC.length, 6)
    assert.ok(observation.temperaturesC.every(Number.isFinite))
  }
})

test('family replay is deterministic and fault declarations have safe mappings', () => {
  for (const family of Object.keys(CONFIGURATION_FAMILIES) as (keyof typeof CONFIGURATION_FAMILIES)[]) {
    const first = replayFamily(family, 240)
    const second = replayFamily(family, 240)
    assert.deepEqual(first, second)
    assert.equal(first.samples.length, 240)
    for (const sample of first.samples) {
      assert.ok(sample.observation.temperaturesC.every(Number.isFinite))
      for (const fault of sample.faults.active) {
        assert.ok(fault.reason.length > 0)
        assert.ok(fault.safeState.length > 0)
        assert.ok(fault.safeOutput.length > 0)
      }
    }
  }
  assert.ok(faultMatrix(CONFIGURATION_FAMILIES['fault-matrix'].faults).length >= 8)
})
