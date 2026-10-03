# Model and Validation v1

Evidence class: `SIMULATED` internally; public exports retain the compatibility value `SIMULATION`. No physical gate passed. Date: 2 October 2026.

## Evidence taxonomy and G0-G6 boundary

`SIMULATED` is deterministic synthetic plant output, `REPLAY` is recorded output replayed without fresh measurement, `LIVE_TABLETOP` is an observed guarded tabletop run, and `FIELD_DATA` is site data collected only after qualified commissioning. Provenance, configuration, calibration status, labels and hashes travel with each new contract record. None of these labels alone proves product-core, food, energy, safety or customer outcomes.

The physical boundary is explicit: G0 safe plant and independent hazardous-energy removal; G1 authority; G2 abstention; G3 tabletop effect; G4 customer acceptance; G5 field effect; G6 repeatability and transfer. This software currently supports only deterministic simulation and fail-closed contract testing. `RESTACK_REQUIRED` and `CAPACITY_OR_EQUIPMENT_FAULT` are future evidence labels; the current simulator does not infer restacking from no response.

## Mathematical scope

For zone i the implemented coarse sensible-heat balance is:

$$
\dot T_i=k_i(\mathbf u)(T_s-T_i)+0.0002(T_{next}-T_i)+q_i/C+P_{fan}/(6C).
$$

The effective rates k have units 1/s; the stored `load` values are q/C in K/s. Assumed zone effective thermal capacity C=4000 J/K is a surrogate including local coupled mass, not the heat capacity of six bare air volumes or an identified product-core model. Assumed fan power is 8u cubed W per fan, valid only as this synthetic response law, not universal PWM physics. The cyclic mixing term sums to zero across equal-capacity zones. Temperatures evolve using one-second explicit Euler; coefficients are chosen with small dimensionless step sizes, not identified experimentally. Supply stays at 3.5 C or 9.4 C in the inadequate-source scenario. Arbitrary layout/load variation, door infiltration, humidity, latent load, defrost thermodynamics, product respiration/core and fan/vane system curves are not solved. Context injection inhibits control; it does not pretend to simulate a real defrost.

Authority estimates use cloned 120-second baseline and isolated 40% pulses from the same deterministic synthetic plant. The difference divided by 0.4 produces a horizon response matrix in K per normalized duty, not FIR time constants. This is an idealized calibration demonstration, not statistical confidence or unseen-layout identification. Assumed 0.2 K uncertainty is not estimated from data. A seed changes one initial temperature slightly; multiple seeds do not constitute independent loading families.

The selector evaluates a discrete actuator grid, penalizing squared upper-limit excursion and illustrative cubic power. It rejects inadequate source, changed configuration/source envelope, insufficient warm-zone influence and predicted lower-limit harm. Its endpoint prediction subtracts the local authority matrix from current temperatures; it does not propagate a validated absolute model or prove every intermediate temperature remains inside limits. `AUTO_CORRECT` means **simulated evidence supports bounded improvement**, not a formal robust feasibility certificate that every warm zone will meet its upper limit in 120 s. No full-rank-controllability or real-room guarantee is claimed. A future qualified controller needs validated disturbance propagation, trajectory constraints, residual uncertainty and timing evidence before that stronger claim.

## Metrics

$$
HDT=\sum_{k,i}\max(0,T_i[k]-8)\Delta t/60,\quad CDT=\sum_{k,i}\max(0,4-T_i[k])\Delta t/60.
$$

Delta t is in seconds; metrics are K min summed over six measured synthetic zone locations. Bounds 4/8 C are illustrative, not commodity safety recipes. Max-min spread includes only zone channels; supply/return are separately reported. Electrical fan energy integrates power times seconds /3600 in Wh. It excludes compressor, defrost, supplies and fan-heat refrigeration penalty: no net-energy saving can be inferred. Return air is a simple arithmetic zone mean, not a validated mass-flow-weighted measurement.

For a full refrigerator, added fan power inside the room also increases thermal load. A 20 W fan running 24 h uses 0.48 kWh; COP=2 would add about 0.24 kWh to remove that heat, before displacement, totaling 0.72 kWh. The rig and software do not establish a COP.

## Executable software checks

- Finite, bounded and repeatable outputs across six scenarios x five comparators.
- Expiry, replay, invalid/future/stale sensor input, interlock, source-state and wet/unobservable surface rejection.
- Blocked path returns inspection/abstention; no `RESTACK_REQUIRED` inference exists.
- Inadequate source returns equipment investigation; no-air-excursion requests zero adaptive airflow.
- Energy/exposure units and CSV evidence class are checked.
- API rejects schema violations and unknown physical command routes; exact export hash verified.
- Browser tests check real nonblank pixels, moving scene, phone/desktop layout and exported media.
- Native firmware tests cover context, condensation, data quality, bounded motion, lease, driver expiry/replay and monotonic wrap.

## Synthetic evaluation protocol (FEAT-005)

`node scripts/evaluate-simulation.mjs --families normal.v1,obstructed.v1,capacity.v1 --seeds 101,202,303,404 --output artifacts/simulation/evaluation.json` produces the machine-readable `coldflow.simulation-evaluation.v1` report. It uses independent 12-second pulse blocks with a five-second stable-window guard, frozen features ending at the decision time, and configuration-family/run/seed grouped holdouts. No pulse block or feature window is reused across groups, and the report explicitly records temporal-leakage and future-feature checks.

The fixed-normal, fixed-high, expert-rule, identified and path-clear comparators are no-ML baselines. Their reports include pulse gain, delay, sign, rank, conditioning, uncertainty/confidence, trajectory/reachability, energy, temperature, condensation, timing/expiry, OOD, abstention and fault-coverage metrics. Constraints are diagnostic evidence only: a failed or out-of-distribution case emits an explicit `ABSTAIN` with zero safe output. The report records all failed and inconclusive cases rather than hiding them in aggregate means. The deterministic safety shield remains authoritative; comparator/advisory output has no direct actuator write path.

The injected door, defrost, inadequate-source, sensor, condensation, interlock, actuator and network cases each carry a named safe state and reason. `RESTACK_REQUIRED` may appear only as a `SIMULATED` synthetic label in this evaluation; it is not a physical diagnosis or a command. No hardware is assembled and no result is field evidence.

## Optional advisory model protocol (FEAT-006)

`node ml/train.mjs --families normal.v1,obstructed.v1,capacity.v1 --seeds 101,202,303,404 --output artifacts/ml/candidate.json` trains a dependency-free nearest-centroid candidate from only `coldflow.frozen-features.v1` pre-decision features. The candidate is evaluated with `node ml/evaluate.mjs --model artifacts/ml/candidate.json --output artifacts/ml/evaluation.json` using leave-one-configuration-family-out grouped holdouts; family/run/seed groups never cross a fold, and future, post-intervention, actuator and outcome fields are excluded. The report includes confusion and calibration, abstention and OOD, seed sensitivity, resource, false-correctable and unsafe-authorization metrics.

The current deterministic record is `NO_ML_BASELINE`: the unseen-family candidate does not clear the documented 0.05 held-out utility margin, while false-correctable and unsafe-authorization risk remain zero. The model card and decision record are removable artifacts of simulation evidence only. Even if a later candidate passes the synthetic gate, its output remains advisory label/reason/confidence/abstention data; it cannot select or write a fan command, bypass `src/domain.ts`, extend a lease, override virtual-device expiry, or replace firmware policy. Hardware calibration, independent transfer groups and qualified physical evidence are required before reconsideration.

## Required physical validation, not completed

First qualify guarded SELV plant and acquisition, then repeated randomized pulses, source/actuator checks and matched path-clear intervention. Freeze family-level holdouts, recipe, calibration, metric dictionary, meaningful effect margins and all comparator exclusions before opening confirmatory tests. Match initial mass/temperatures, source/ambient profile and horizon; report failed/inconclusive runs, all zones and cold exposure. Include fixed-normal/high, expert rules, physical fixes and appropriately justified identified feedback/MPC baselines. Obtain calibration/uncertainty and independent witness. Pilot starts monitor-only with qualified approval; commodity/core/grade/weight and whole-refrigerator outcomes are separate tests.

Zero misses in 29 independent cases gives one-sided 95% success lower bound about 0.902; zero false-correctable decisions in 59 independent cases gives upper bound about 0.0495. Under a justified Poisson assumption zero alarms over 36 h gives upper rate about 0.0832/h. These are planning formulas, not current results, and software seeds/windows are not independent physical cases.

Literature context: [2024 arrangement CFD](https://doi.org/10.1038/s41598-024-76385-y), [2025 clearance CFD](https://doi.org/10.1038/s41598-025-95886-y), [cultivar/temperature review](https://doi.org/10.3390/foods12030466). Related CFD papers are not two independent field replications. Published modeled results are never attributed to ColdFlow.