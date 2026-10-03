# ColdFlow advisory model card

- **Model:** `nearest-centroid-v1`
- **Artifact schema:** `coldflow.advisory-model.v1`
- **Evidence:** SIMULATED synthetic simulator output only
- **Generated:** 2026-01-01T00:00:00.000Z
- **Artifact hash:** `54482d7bfd9c54aff2f02f7a1983e916dc44b011f70bd4357117839e50e7b101`
- **Feature manifest hash:** `e39ac4f7a92ead61432d51396b35fef33b6dab2526117d9ce5791a65b337673a`
- **Source report hash:** `991062c937857e1c0af6366fac4d7ceed8a3ba824ae264c20584056fc0b7075e`

## Intended use
This is an optional, shallow advisory classifier for simulation review. It emits a label, reason, confidence and abstention signal; it does not produce a fan command, setpoint, lease, interlock decision or actuator write. The deterministic ColdFlow shield, virtual-device expiry rules and future firmware policy remain authoritative.

## Training and evaluation
Training uses only the versioned FEAT-005 report and frozen pre-decision features: meanTemperatureC, spreadC, supplyC, maxSlopeCPerSecond. It uses standard-library arithmetic and a nearest-centroid model with deterministic leave-one-configuration-family-out grouped folds. Entire family/run/seed groups are kept together. Future, post-intervention, actuator and outcome fields are excluded from the feature vector.

The held-out evaluation reported **12** rows, **12** abstentions, **0.333333** accuracy among all rows, **0** false-correctable predictions, and **3/3** synthetic OOD detections. The selection result is **NO_ML_BASELINE**.

## Limitations and transfer
All labels and measurements are synthetic rules from the current simulator. The artifact is not calibrated against hardware, product core, food quality, refrigerant behavior, airflow instrumentation or field conditions. Seeds and repeated simulator windows are not independent physical evidence. Leave-one-family-out performance is an OOD/transfer probe, not proof of an unseen room or recipe. A later physical workflow must freeze labels, calibration, meaningful margins, independence, failure handling and human approval before any deployment decision.

## Selection boundary
The declared gate requires a held-out utility improvement of at least 0.05 with no increase in false-correctable risk or unsafe-authorization risk. If that gate is not met, the removable fallback is **NO_ML_BASELINE**.
