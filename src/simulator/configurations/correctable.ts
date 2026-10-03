import type { ConfigurationManifest } from '../configuration.ts'

export const correctableConfiguration = {
  version: 'cf-sim-config-v1', family: 'correctable', manifestHash: 'fnv1a4:7a8d4b92dbcd923ed7fcc0580280e7ce', seed: 2026,
  assumptions: ['Declared synthetic warm-zone excursion with bounded airflow authority', 'Reduced-order sensible heat only; no product-core or CFD claim', 'Comparator is advisory and simulation-only', 'No physical ground truth, actuator authority, or equipment diagnosis'],
  synthetic: { evidenceClass: 'SIMULATED', source: 'DECLARED_SYNTHETIC_CONFIGURATION', physicalHardwareAssembled: false, physicalGroundTruth: false },
  authority: { comparator: 'ADVISORY_ONLY', actuator: 'DISABLED', safety: 'DETERMINISTIC_SHIELD_AUTHORITATIVE' },
  boundedCriteria: { initialTargetZones: [0], upperLimitC: 8, maxDuty: 0.8, maxEnergyWh: 4, maxDurationSeconds: 30, condensationClearanceC: 2 },
  air: { initialTemperaturesC: [8.05, 7.2, 7.1, 6.9, 7.0, 7.1], supplyTemperatureC: 3.5, thermalMassC: [1, 1, 1, 1, 1, 1], mixingConductance: 0.0002, actuatorConductance: [[0.06, 0.05], [0.0018, 0.001], [0.0009, 0.0025], [0.0025, 0.0005], [0.0012, 0.0018], [0.0005, 0.0032]], loads: [0.001, 0.001, 0.001, 0.001, 0.001, 0.001] },
  source: { proven: true, temperatureC: 3.5 }, door: { open: false, infiltrationLoad: 0 }, defrost: { active: false, sourceTemperatureC: 3.5 }, humidity: { relativeHumidity: 0.55, moistureLoad: 0 }, condensation: { wet: false, surfaceMinimumC: 4, dewPointC: 0, uncertaintyC: 0.5 },
  fans: { response: 1, powerCoefficient: 8 }, faults: [],
} satisfies ConfigurationManifest
