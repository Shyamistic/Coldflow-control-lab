import type { ConfigurationManifest } from '../configuration.ts'

export const normalConfiguration = {
  version: 'cf-sim-config-v1', family: 'normal', manifestHash: 'fnv1a4:50b62b020ff71d56906ac73abff248a4', seed: 2026,
  assumptions: ['Six well-mixed air zones', 'Reduced-order sensible heat only', 'No product-core or CFD claim', 'Fan duty is normalized and simulation-only'],
  air: { initialTemperaturesC: [6.5, 6.7, 6.8, 6.4, 6.6, 6.7], supplyTemperatureC: 3.5, thermalMassC: [1, 1, 1, 1, 1, 1], mixingConductance: 0.0002, loads: [0.001, 0.001, 0.001, 0.001, 0.001, 0.001] },
  source: { proven: true, temperatureC: 3.5 }, door: { open: false, infiltrationLoad: 0 }, defrost: { active: false, sourceTemperatureC: 3.5 }, humidity: { relativeHumidity: 0.55, moistureLoad: 0 }, condensation: { wet: false, surfaceMinimumC: 4, dewPointC: 0, uncertaintyC: 0.5 },
  fans: { response: 1, powerCoefficient: 8 }, faults: [],
} satisfies ConfigurationManifest
