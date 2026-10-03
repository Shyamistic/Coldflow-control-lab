# ColdFlow advisory model card

- **Model:** `nearest-centroid-v1`
- **Artifact schema:** `coldflow.advisory-model.v1`
- **Evidence:** SIMULATED synthetic simulator output only
- **Generated:** 2026-01-01T00:00:00.000Z
- **Artifact hash:** `d10e65315e1bf40f6026b968d1b24d8a71ee24611d5d08bb7d03d446c915f0f7`
- **Feature manifest hash:** `56d1dadf7bf2bf2c6ab0df97105b3144854c0d451b963a6f085a0040f687f7bd`
- **Source report hash:** `cba01ddab7cef55b7c6381fee0688f93bb6a31b2a5499d22df29177880990e65`

## Intended use
This is an optional, shallow advisory classifier for simulation review. It emits a label, reason, confidence and abstention signal; it does not produce a fan command, setpoint, lease, interlock decision or actuator write. The deterministic ColdFlow shield, virtual-device expiry rules and future firmware policy remain authoritative.

## Training and evaluation
Training uses only the versioned FEAT-005 report and frozen pre-decision features: meanTemperatureC, spreadC, supplyC, maxSlopeCPerSecond. It uses standard-library arithmetic and a nearest-centroid model with deterministic leave-one-configuration-family-out grouped folds. Entire family/run/seed groups are kept together. Future, post-intervention, actuator and outcome fields are excluded from the feature vector.

The held-out evaluation reported **12** rows, **12** abstentions, **0** accuracy among all rows, **0** false-correctable predictions, and **3/3** synthetic OOD detections. The selection result is **NO_ML_BASELINE**.

## Limitations and transfer
All labels and measurements are synthetic rules from the current simulator. The artifact is not calibrated against hardware, product core, food quality, refrigerant behavior, airflow instrumentation or field conditions. Seeds and repeated simulator windows are not independent physical evidence. Leave-one-family-out performance is an OOD/transfer probe, not proof of an unseen room or recipe. A later physical workflow must freeze labels, calibration, meaningful margins, independence, failure handling and human approval before any deployment decision.

## Selection boundary
The declared gate requires a held-out utility improvement of at least 0.05 with no increase in false-correctable risk or unsafe-authorization risk. If that gate is not met, the removable fallback is **NO_ML_BASELINE**.
