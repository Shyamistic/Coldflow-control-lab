import type { ConfigurationManifest } from '../configuration.ts'
import { createFaultEvent } from '../faults.ts'

export const faultMatrixConfiguration = {
  version: 'cf-sim-config-v1', family: 'fault-matrix', manifestHash: 'fnv1a4:713759e91bcf9d1598436b3dd7b219b3', seed: 2026,
  assumptions: ['Faults are deterministic schedule inputs', 'Every fault has a named safe state and safe output', 'Network and actuator layers are abstract only', 'No physical actuator route exists'],
  air: { initialTemperaturesC: [10.34, 8.9, 7.4, 6.6, 7.1, 8.5], supplyTemperatureC: 3.5, thermalMassC: [1, 1, 1, 1, 1, 1], mixingConductance: 0.0002, loads: [0.006, 0.004, 0.003, 0.002, 0.003, 0.004] },
  source: { proven: true, temperatureC: 3.5 }, door: { open: false, infiltrationLoad: 0 }, defrost: { active: false, sourceTemperatureC: 3.5 }, humidity: { relativeHumidity: 0.55, moistureLoad: 0 }, condensation: { wet: false, surfaceMinimumC: 4, dewPointC: 0, uncertaintyC: 0.5 },
  fans: { response: 1, powerCoefficient: 8 }, faults: [createFaultEvent('SENSOR_STALE', 30, 45), createFaultEvent('SENSOR_DROPOUT', 60, 75), createFaultEvent('ACTUATOR_NO_FEEDBACK', 90, 105), createFaultEvent('NETWORK_DELAY', 120, 135), createFaultEvent('NETWORK_LOSS', 150, 165), createFaultEvent('HUMIDITY_HIGH', 180, 195), createFaultEvent('CONDENSATION_RISK', 210, 225), createFaultEvent('DEFROST', 240, 255)],
} satisfies ConfigurationManifest
