# ColdFlow advisory model card

- **Model:** `nearest-centroid-v1`
- **Artifact schema:** `coldflow.advisory-model.v1`
- **Evidence:** SIMULATED synthetic simulator output only
- **Generated:** 2026-01-01T00:00:00.000Z
- **Artifact hash:** `82ad9b58a6479bca7a76a34aebd1391ecedfa12261a9c3d41590516d366ef07f`
- **Feature manifest hash:** `c8369006135f529bf0b12f4ecf00f9d56b778224920a188b321761360b7d269d`
- **Source report hash:** `63499f0c2d239632b2b1e6db814a22309e3798216f122e890c12c4d6f03f2aac`

## Intended use
This is an optional, shallow advisory classifier for simulation review. It emits a label, reason, confidence and abstention signal; it does not produce a fan command, setpoint, lease, interlock decision or actuator write. The deterministic ColdFlow shield, virtual-device expiry rules and future firmware policy remain authoritative.

## Training and evaluation
Training uses only the versioned FEAT-005 report and frozen pre-decision features: meanTemperatureC, spreadC, supplyC, maxSlopeCPerSecond. It uses standard-library arithmetic and a nearest-centroid model with deterministic leave-one-configuration-family-out grouped folds. Entire family/run/seed groups are kept together. Future, post-intervention, actuator and outcome fields are excluded from the feature vector.

The held-out evaluation reported **12** rows, **12** abstentions, **0.333333** accuracy among all rows, **0** false-correctable predictions, and **3/3** synthetic OOD detections. The selection result is **NO_ML_BASELINE**.

## Limitations and transfer
All labels and measurements are synthetic rules from the current simulator. The artifact is not calibrated against hardware, product core, food quality, refrigerant behavior, airflow instrumentation or field conditions. Seeds and repeated simulator windows are not independent physical evidence. Leave-one-family-out performance is an OOD/transfer probe, not proof of an unseen room or recipe. A later physical workflow must freeze labels, calibration, meaningful margins, independence, failure handling and human approval before any deployment decision.

## Selection boundary
The declared gate requires a held-out utility improvement of at least 0.05 with no increase in false-correctable risk or unsafe-authorization risk. If that gate is not met, the removable fallback is **NO_ML_BASELINE**.
