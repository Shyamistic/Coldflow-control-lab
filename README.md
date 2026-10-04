# ColdFlow Control Lab

ColdFlow is a competition software demonstrator: a six-zone air-temperature simulation, bounded secondary-airflow decisions, conservative abstention, comparator evaluation, and an interactive Three.js chamber concept. **It is simulation-only: not live hardware, product-core measurement, certified safety equipment, field validation, or a measured energy/food-loss result.** Physical evidence gates G0-G6 remain unpassed.

## Public release boundary

The canonical public experiment path is `POST /api/experiments` → `runCanonicalExperiment` → the versioned configuration, plant, and `VirtualDevice` path identified as `VERSIONED_PLANT_VIRTUAL_DEVICE`. Its output is deterministic and records configuration, manifest, output, and replay hashes. The older domain facade is compatibility-only; it is not a second physical or control path. Public `SIMULATION` values remain for REST/CSV/JSON compatibility, while canonical provenance uses `SIMULATED` and replay uses `REPLAY`.

The simulator includes `correctable.v1`, an intentionally synthetic family with a declared warm-zone excursion and bounded simulated airflow authority. It is useful for testing a positive passing criterion; it is not a measured or physical correction result. Normal `NO_EXCURSION` cases are no-action (`NO_ACTION`, reason `NO_EXCURSION_ALREADY_IN_TARGET`), not unreachable and not corrective evidence. Obstructed, inadequate-source, stale-sensor, actuator, and out-of-envelope cases are evidence-gated failures or `ABSTAIN`; `RESTACK_REQUIRED` is emitted only by the grouped synthetic evaluation when bounded failure and matched path-clear improvement are both observed. These labels are advisory and never grant actuator authority.

No hardware is assembled or commissioned. Firmware remains disabled and fail-closed; G0-G6 are not passed. The 3D view is a concept visualization, not CFD or a calibrated digital twin. Synthetic labels are not physical ground truth, host tests are not hardware-in-the-loop, and the project makes no production, food, energy, field-efficacy, or certification claim.

See [docs/provenance.md](docs/provenance.md) for evidence rules and [docs/traceability.csv](docs/traceability.csv) for the software evidence map.

## Public links

- [Deployed simulation dashboard](https://coldflow-demo-749096933589.asia-south1.run.app)
- [Source repository](https://github.com/Shyamistic/Coldflow-control-lab)
- [Architecture and data flow](docs/architecture.md)

## Architecture at a glance

```text
React + Three.js dashboard
          │
          ├── browser-safe canonical adapter
          └── Express simulation API
                    │
        versioned configuration + seed
                    │
     six-zone reduced-order plant model
                    │
              VirtualDevice
                    │
 deterministic safety shield + fault policy
                    │
     SIMULATED telemetry / hashes / labels
                    │
       recorder, replay, evaluation, ML

Separate boundary: portable C++ safety/HAL scaffold
                 (fail-closed, pins disabled)

Cloud Run hosts the stateless simulation service only.
```

The complete component map, data flow, safety boundary, and future qualified hardware boundary are documented in [docs/architecture.md](docs/architecture.md). The dashboard and API use the same versioned `VERSIONED_PLANT_VIRTUAL_DEVICE` experiment path; the older domain facade remains compatibility-only and is not evidence-producing control logic.

## Submission demonstration flow

For a short reviewer walkthrough, use this sequence:

1. Open the deployed dashboard and point out the persistent `SIMULATION ONLY` and `HARDWARE CONNECTED: NO` boundary.
2. Select **Correctable synthetic**, approve the simulated lease, and play the six-zone concept view to show a bounded synthetic correction with manifest/configuration/output/replay hashes.
3. Open **Experiments** and run the comparator pack. Highlight the normal `NO_EXCURSION` no-action result, the synthetic `CORRECTABLE` result, and the obstruction/capacity/fault `ABSTAIN` or inspection results.
4. Open **Model & boundaries** to show the air-only equations, authority table, OEM boundary, and explicit limitations.
5. Export the labelled CSV/PNG/WebM only as simulation media. Do not present synthetic labels as physical ground truth.

The proposed hardware image, deployed-dashboard screenshots, architecture figure, pitch deck, and final video are intentionally maintained as a later submission-media phase. When added, store only reviewed, simulation/proposed-labelled assets under a public-safe media directory; keep private research, raw recordings, credentials, and unreviewed materials outside the repository.

## Run and demonstrate

Node 24 and the supplied npm lockfile are required. The dashboard runs against the built server at `http://localhost:8080`; `npm run dev` starts the Vite frontend and proxies `/api` to that server.

```sh
npm ci
npm run build
npm start
```

Select a scenario and comparator, approve a **simulated** 60-second lease, then play or scrub the deterministic synthetic record. Reset or changing scenarios revokes the browser lease. The UI shows hashes, provenance, zone-air traces, bounded model output, faults, and export controls. PNG/WebM exports are visibly marked `3D CONCEPT - SIMULATION ONLY`; browser-produced files are not server-stored.

Scenarios include balanced loading, partial/full obstruction, inadequate source, stale probe, actuator fault, and the declared synthetic correctable excursion. Comparators include fixed-normal, fixed-high, expert rule, identified control, and path-clear. The path-clear comparator changes only the synthetic obstruction configuration; it is not a restack experiment.

## Clean-checkout verification gate

From a clean checkout, install dependencies and run the normal release gate. The test script regenerates the evaluation report, builds the application, runs the Node contract/simulator/evidence suites, and runs Playwright unless `--unit-only` is supplied.

```sh
npm ci
npx playwright install chromium
npm test
npm run lint
npm run build
npm run evaluate:simulation
npm run test:e2e
```

The release gate also supports the documented replay and model checks. Outputs belong under ignored `artifacts/` and must not be committed:

```sh
node scripts/record-simulation.mjs --family normal.v1 --seed 2026 --output artifacts/simulation/run.jsonl
node scripts/replay-simulation.mjs --input artifacts/simulation/run.jsonl --report artifacts/simulation/replay-report.json
node ml/train.mjs --families normal.v1,obstructed.v1,capacity.v1,correctable.v1 --seeds 101,202,303,404 --output artifacts/ml/candidate.json
node ml/evaluate.mjs --model artifacts/ml/candidate.json --output artifacts/ml/evaluation.json
npm sbom --sbom-format=cyclonedx > artifacts/sbom.json
node scripts/check-sbom.mjs artifacts/sbom.json docs/license-allowlist.json artifacts/sbom-check.json
```

Native g++ and PlatformIO checks are additional CI/toolchain gates when those tools are available; they do not energize or certify hardware. Docker checks likewise require a running Docker Desktop engine and produce no physical evidence.

## Release evidence and deployment verification

A release is not complete until source revision, package-lock hash, passed command results, evaluation report, advisory model decision/artifact, replay JSONL/report/trusted anchor, SBOM/license result, immutable image digest, and an identity-bound deployment verification are bound in the ignored `artifacts/release/release-manifest.json`. Capture `gcloud run services describe SERVICE --region REGION --format=json` output and run `scripts/verify-cloud-run-deployment.mjs` before manifest creation; it rejects mismatched service, region, 100%-traffic revision, digest-pinned image, source-revision label, or route revision. The manifest cannot contain itself and is reproducibility evidence, not a signature or physical chain of custody. The deployment checks must cover `/api/live`, `/api/ready`, `/api/health`, `/api/metrics`, and `/api/experiments`. `/api/ready` must continue to report `hardwareConnected: false`, no physical gates, and no actuator authority. `/api` has no physical command route.

Generated evaluation, replay, SBOM, browser, Docker, and release-manifest files are local/CI evidence and remain outside source control. Do not publish credentials, private research, raw customer data, generated binaries, or ignored artifacts.

## Cloud and optional AI

The public service is stateless and has no database, persistent customer data, authentication, telemetry ingestion, or actuator API. Keep Cloud Run min instances at 0 and max instances at 1 unless separately reviewed; rate limiting is process-local and not a spending boundary. `/api/explain` is deterministic. Optional `/api/vertex-explain` is disabled by default and explanation-only when explicitly configured; it cannot issue setpoints or control commands. Secrets belong in Secret Manager, never browser code or committed files.

## Submission wording

**ColdFlow is an interactive, simulation-only software demonstrator for bounded airflow-control reasoning. It presents deterministic virtual-device experiments, safety-oriented abstention, provenance, and reproducible evaluation. No hardware has been assembled or commissioned; no physical, production, food, energy, field, CFD/digital-twin, ground-truth, hardware-in-the-loop, or certification claim is made.**

The source pack includes a disabled-by-default firmware scaffold and a 3D concept, not a field-ready installation or fabrication drawing. Any future hardware, calibration, qualification, customer acceptance, signed remote command, OTA, industrial protocol, or site evidence remains a separately gated activity.
