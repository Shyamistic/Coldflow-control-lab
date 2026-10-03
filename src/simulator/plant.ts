import { SIMULATION_PROFILE } from '../contracts.ts'
import type { Pair, Plant, Scenario, ZoneVector } from '../domain.ts'
import type { ConfigurationManifest } from './configuration.ts'
import type { FaultState } from './faults.ts'

export interface PlantState {
  family: ConfigurationManifest['family']
  version: ConfigurationManifest['version']
  seed: number
  seconds: number
  airC: ZoneVector
  thermalMassC: ZoneVector
  supplyC: number
  returnAirC: number
  humidity: number
  dewPointC: number
  surfaceMinimumC: number
  condensationRisk: boolean
  sourceProven: boolean
  doorOpen: boolean
  defrost: boolean
  fanDuty: Pair
  fanPowerW: number
  fanEnergyWh: number
  hotDegreeMinutes: number
  coldDegreeMinutes: number
  loads: ZoneVector
  conductance: Pair[]
}

export interface DisturbanceState {
  sourceTemperatureC: number
  doorOpen: boolean
  defrost: boolean
  humidity: number
  condensationRisk: boolean
}

export interface ActuatorState {
  requested: Pair
  applied: Pair
  feedbackHealthy: boolean
  powerW: number
}

export interface Observation {
  seconds: number
  measuredAtMs: number
  temperaturesC: ZoneVector
  supplyC: number
  returnAirC: number
  humidity: number
  dewPointC: number
  surfaceMinimumC: number
  fanDuty: Pair
  fanPowerW: number
}

export function createPlant(manifest: ConfigurationManifest): PlantState {
  const temperatures = [...manifest.air.initialTemperaturesC] as ZoneVector
  const sourceTemperature = manifest.source.temperatureC
  return {
    family: manifest.family, version: manifest.version, seed: manifest.seed, seconds: 0, airC: temperatures, thermalMassC: [...manifest.air.thermalMassC] as ZoneVector,
    supplyC: sourceTemperature, returnAirC: temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length, humidity: manifest.humidity.relativeHumidity, dewPointC: manifest.condensation.dewPointC, surfaceMinimumC: manifest.condensation.surfaceMinimumC, condensationRisk: manifest.condensation.wet,
    sourceProven: manifest.source.proven, doorOpen: manifest.door.open, defrost: manifest.defrost.active, fanDuty: [0, 0], fanPowerW: 0, fanEnergyWh: 0, hotDegreeMinutes: 0, coldDegreeMinutes: 0,
    loads: [...manifest.air.loads] as ZoneVector, conductance: manifest.air.actuatorConductance.map(([a, b]) => [a, b] as Pair),
  }
}

export function stepPlant(plant: PlantState, requested: Pair, disturbance: DisturbanceState, faults: FaultState, seconds = 1): PlantState {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 5 || !requested.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Invalid integration step or actuator input')
  const applied: Pair = faults.actuatorNoFeedback || faults.actuatorStuck || faults.networkLoss ? [0, 0] : requested
  const fanPower = applied.reduce((sum, value) => sum + 8 * value ** 3, 0)
  const source = disturbance.sourceTemperatureC + (disturbance.defrost ? 1.5 : 0)
  const temperatures = plant.airC.map((value, index) => {
    const neighbour = plant.airC[(index + 1) % 6]
    const exchange = 0.00055 + plant.conductance[index][0] * applied[0] + plant.conductance[index][1] * applied[1]
    const infiltration = disturbance.doorOpen ? 0.001 : 0
    const moistureLoad = disturbance.humidity > 0.8 ? 0.0002 : 0
    return Math.max(-20, Math.min(50, value + seconds * ((exchange * (source - value) + plant.conductance[index][0] * 0.0001 * (plant.thermalMassC[index] - value) + 0.0002 * (neighbour - value) + plant.loads[index] + infiltration + moistureLoad + fanPower / 6 / 4000) / plant.thermalMassC[index])))
  }) as ZoneVector
  const mean = temperatures.reduce((sum, value) => sum + value, 0) / 6
  return { ...plant, seconds: plant.seconds + seconds, airC: temperatures, supplyC: source, returnAirC: mean, humidity: Math.max(0, Math.min(1, disturbance.humidity)), doorOpen: disturbance.doorOpen, defrost: disturbance.defrost, condensationRisk: disturbance.condensationRisk, fanDuty: applied, fanPowerW: fanPower, fanEnergyWh: plant.fanEnergyWh + fanPower * seconds / 3600, hotDegreeMinutes: plant.hotDegreeMinutes + temperatures.reduce((sum, value) => sum + Math.max(0, value - SIMULATION_PROFILE.highTemperatureC), 0) * seconds / 60, coldDegreeMinutes: plant.coldDegreeMinutes + temperatures.reduce((sum, value) => sum + Math.max(0, SIMULATION_PROFILE.lowTemperatureC - value), 0) * seconds / 60 }
}

export function observePlant(plant: PlantState): Observation {
  return { seconds: plant.seconds, measuredAtMs: plant.seconds * 1000, temperaturesC: [...plant.airC], supplyC: plant.supplyC, returnAirC: plant.returnAirC, humidity: plant.humidity, dewPointC: plant.dewPointC, surfaceMinimumC: plant.surfaceMinimumC, fanDuty: [...plant.fanDuty], fanPowerW: plant.fanPowerW }
}

export function createLegacyPlant(scenario: Scenario, seed = 2026): Plant {
  const variation = ((seed % 17) - 8) * 0.02
  const balanced = scenario === 'normal'
  const temperatures: ZoneVector = balanced ? [6.5, 6.7, 6.8, 6.4, 6.6, 6.7] : [10.5 + variation, 8.9, 7.4, 6.6, 7.1, 8.5]
  const conductance: Pair[] = [[0.0035, 0.0004], [0.0018, 0.001], [0.0009, 0.0025], [0.0025, 0.0005], [0.0012, 0.0018], [0.0005, 0.0032]]
  if (scenario === 'blocked') conductance[0] = [0.00001, 0.00001]
  return { scenario, temperatures, supply: scenario === 'capacity' ? 9.4 : 3.5, returnAir: temperatures.reduce((sum, value) => sum + value, 0) / 6, seconds: 0, fanWh: 0, hotDegreeMinutes: 0, coldDegreeMinutes: 0, load: balanced ? [0.001, 0.001, 0.001, 0.001, 0.001, 0.001] : [0.006, 0.004, 0.003, 0.002, 0.003, 0.004], conductance }
}

export function stepLegacyPlant(plant: Plant, fans: Pair, seconds = 1): Plant {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 5 || !fans.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Invalid integration step or actuator input')
  const actual: Pair = plant.scenario === 'actuator' ? [0, 0] : fans
  const fanPower = actual.reduce((sum, value) => sum + 8 * value ** 3, 0)
  const temperatures = plant.temperatures.map((value, index) => {
    const neighbour = plant.temperatures[(index + 1) % 6]
    const base = plant.scenario === 'blocked' && index === 0 ? 0.0001 : 0.00055
    const exchange = base + plant.conductance[index][0] * actual[0] + plant.conductance[index][1] * actual[1]
    return value + seconds * (exchange * (plant.supply - value) + 0.0002 * (neighbour - value) + plant.load[index] + fanPower / 6 / 4000)
  }) as ZoneVector
  const mean = temperatures.reduce((sum, value) => sum + value, 0) / 6
  return { ...plant, temperatures, returnAir: mean, seconds: plant.seconds + seconds, fanWh: plant.fanWh + fanPower * seconds / 3600, hotDegreeMinutes: plant.hotDegreeMinutes + temperatures.reduce((sum, value) => sum + Math.max(0, value - SIMULATION_PROFILE.highTemperatureC), 0) * seconds / 60, coldDegreeMinutes: plant.coldDegreeMinutes + temperatures.reduce((sum, value) => sum + Math.max(0, SIMULATION_PROFILE.lowTemperatureC - value), 0) * seconds / 60 }
}
