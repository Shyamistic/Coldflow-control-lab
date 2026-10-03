# Evidence Provenance v1

ColdFlow uses evidence labels to prevent synthetic records from being mistaken for physical validation. The public application keeps the existing `SIMULATION` value in REST, CSV and JSON outputs for compatibility; the versioned contracts use `SIMULATED` as the canonical internal class.

## Evidence classes

| Class | Meaning | What it cannot establish |
| --- | --- | --- |
| `SIMULATED` | Deterministic plant, sensor, actuator and disturbance model output with configuration, seed and replayable protocol. | Physical authority, food/product outcome, energy saving, safety certification or field effect. |
| `REPLAY` | Previously recorded data replayed with its original measurement times and provenance. | A new observation or current equipment state. |
| `LIVE_TABLETOP` | Guarded, instrumented tabletop observation after G0 readiness and with a declared protocol. | Site transfer, customer acceptance or unqualified field control. |
| `FIELD_DATA` | Site data collected under qualified commissioning, approved instrumentation and documented chain of custody. | Generalization beyond the tested configuration or any safety certification not separately granted. |

Every record should identify its schema version, boot/session identity, monotonic sequence, measurement and capture times, configuration/calibration revision, uncertainty, source and manifest hash. A label is an evidence annotation, not a controller command. `CORRECTABLE`, `RESTACK_REQUIRED`, `CAPACITY_OR_EQUIPMENT_FAULT`, `SENSOR_OR_EVENT_ARTIFACT`, `UNKNOWN` and `ABSTAIN` must retain their rationale and may be `ABSTAIN` when evidence is contradictory or out of envelope.

## Physical G0-G6 boundary

- **G0 — safe plant:** guarded SELV hardware, independent hazardous-energy removal, interlocks and qualified reset behavior.
- **G1 — authority:** repeated matched pulses, source/actuator observations, calibration and uncertainty.
- **G2 — abstention:** held-out faults and disturbances reject unsafe or unsupported decisions.
- **G3 — tabletop effect:** independently witnessed effect against frozen comparators and metrics.
- **G4 — customer acceptance:** defined operator pain, cost, payer and acceptance criteria.
- **G5 — field effect:** monitor-only deployment followed by separately qualified control, with site evidence.
- **G6 — repeatability/transfer:** sealed configuration-family holdouts and an independent second-room or equivalent transfer test.

No current repository artifact passes a physical gate. The simulator’s `RESTACK_REQUIRED` state is reserved for a future qualified workflow; the current blocked-path behavior remains abstention/inspection and does not diagnose restacking. Model or AI output is advisory only and never grants actuator authority.
