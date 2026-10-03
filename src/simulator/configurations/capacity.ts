import type { ConfigurationManifest } from '../configuration.ts'

export const capacityConfiguration = {
  version: 'cf-sim-config-v1', family: 'capacity', manifestHash: 'fnv1a4:8b48f4ef6f6f4f930d784b2b89d8a085', seed: 2026,
  assumptions: ['Supply source is warmer than the public high-temperature limit', 'Fans cannot manufacture source cooling', 'Six well-mixed air zones', 'No compressor control or equipment diagnosis'],
  air: { initialTemperaturesC: [10.34, 8.9, 7.4, 6.6, 7.1, 8.5], supplyTemperatureC: 9.4, thermalMassC: [1, 1, 1, 1, 1, 1], mixingConductance: 0.0002, actuatorConductance: [[0.0035, 0.0004], [0.0018, 0.001], [0.0009, 0.0025], [0.0025, 0.0005], [0.0012, 0.0018], [0.0005, 0.0032]], loads: [0.006, 0.004, 0.003, 0.002, 0.003, 0.004] },
  source: { proven: true, temperatureC: 9.4 }, door: { open: false, infiltrationLoad: 0 }, defrost: { active: false, sourceTemperatureC: 9.4 }, humidity: { relativeHumidity: 0.55, moistureLoad: 0 }, condensation: { wet: false, surfaceMinimumC: 4, dewPointC: 0, uncertaintyC: 0.5 },
  fans: { response: 1, powerCoefficient: 8 }, faults: [],
} satisfies ConfigurationManifest
