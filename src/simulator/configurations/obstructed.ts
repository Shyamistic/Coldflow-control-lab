import type { ConfigurationManifest } from '../configuration.ts'
import { createFaultEvent } from '../faults.ts'

export const obstructedConfiguration = {
  version: 'cf-sim-config-v1', family: 'obstructed', manifestHash: 'fnv1a4:468447bba1d5a747ed3fdc8358ccb9f5', seed: 2026,
  assumptions: ['Back-left airflow authority is reduced', 'Obstruction is a geometry/load assumption, not a restack diagnosis', 'Six well-mixed air zones', 'No product-core or CFD claim'],
  air: { initialTemperaturesC: [10.34, 8.9, 7.4, 6.6, 7.1, 8.5], supplyTemperatureC: 3.5, thermalMassC: [1, 1, 1, 1, 1, 1], mixingConductance: 0.0002, actuatorConductance: [[0.00001, 0.00001], [0.0018, 0.001], [0.0009, 0.0025], [0.0025, 0.0005], [0.0012, 0.0018], [0.0005, 0.0032]], loads: [0.006, 0.004, 0.003, 0.002, 0.003, 0.004] },
  source: { proven: true, temperatureC: 3.5 }, door: { open: false, infiltrationLoad: 0 }, defrost: { active: false, sourceTemperatureC: 3.5 }, humidity: { relativeHumidity: 0.55, moistureLoad: 0 }, condensation: { wet: false, surfaceMinimumC: 4, dewPointC: 0, uncertaintyC: 0.5 },
  fans: { response: 1, powerCoefficient: 8 }, faults: [createFaultEvent('DOOR_OPEN', 240, 270)],
} satisfies ConfigurationManifest
