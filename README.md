# ColdFlow Control Lab

Competition software demonstrator: six-zone air-temperature simulation, bounded secondary-airflow decisions, conservative abstention, comparisons and a Three.js chamber concept. **Not live hardware, product-core measurement, certified safety equipment, field validation or a measured energy/food-loss result.** Physical evidence gates G0-G6 remain unpassed.

## Public Links

- [Deployed simulation dashboard](https://coldflow-demo-749096933589.asia-south1.run.app)
- [Source repository](https://github.com/Shyamistic/Coldflow-control-lab)

## Run

Node 24 recommended; npm lockfile supplied.

```sh
npm ci
npm test
npm run build
npm start
```

Production server: http://localhost:8080. For frontend development run `npm run dev`; Vite proxies `/api` to the server on 8080. A port already in use must be changed rather than stopping somebody else's server. Use `PORT` for the API and Vite's `--port` for development.

## Demonstration

Select a scenario and comparator, approve a **simulated** 60-second lease, then play or scrub the precomputed synthetic record. Source context and the software cutout gate browser playback/animation, not physical equipment. Reset or a scenario change revokes the browser lease. Experimental leases inside deterministic runs are synthetically renewed; this is not a real unattended control policy.

The scenario set covers partial/full obstruction, inadequate source, stale probe, actuator fault and balanced loading. Compare fixed-normal, fixed-high, expert rule, identified control and physical path-clear. All comparators share the same safety envelope. The path-clear comparator changes the synthetic conductance/load only for obstruction scenarios; it is not a measured restack experiment.

CSV/JSON exports carry `SIMULATION`. PNG and up-to-12-second WebM exports visibly carry `3D CONCEPT - SIMULATION ONLY`. Canvas exports omit DOM UI overlays; the rendered geometry and provenance are captured. Output files are produced by the browser, not server-stored. Scene colors are illustrative probe-linked categories, not a thermal-camera field. The geometry currently depicts fans/crates/plenum/external electronics, not a complete fabrication drawing or an implemented servo-vane mechanism.

## Verification

```sh
npm test
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
g++ -std=c++17 -Wall -Wextra -Werror firmware/tests/safety_test.cpp -o safety-test
./safety-test
pio run --project-dir firmware
```

The browser suite runs against the built production server and checks desktop/mobile workflows, nonblank/moving canvas pixels, no page overflow, faults, traces, downloads, comparisons and concept-video encoding. Artifacts go to ignored `artifacts/browser`; screenshots must also be visually reviewed. Run a hosted check by setting `TEST_URL` to the deployment URL. Firmware native tests exercise the portable safety policy; PlatformIO compiles the ESP32-S3 image. **Neither test energizes or certifies hardware.** Library warnings are not suppressed to disguise them.

See [docs/model-validation.md](docs/model-validation.md), [docs/firmware.md](docs/firmware.md), [docs/protocols.md](docs/protocols.md), [docs/rest-api-v1.yaml](docs/rest-api-v1.yaml), and [docs/traceability.csv](docs/traceability.csv).

## Cloud and AI

The Dockerfile uses an unprivileged Node user. The public demonstration has no database, persistent customer data, authentication, telemetry ingestion or actuator API. Set Cloud Run min instances to 0, max instances to 1 and use a dedicated service account with no project roles for this public simulation. Rate limiting is process-local; it is not a production abuse-control boundary or guaranteed spending cap. Cloud Build/artifact storage/egress may still cost money.

`/api/explain` is deterministic and costs no AI tokens. `/api/vertex-explain` is an optional **explanation-only** adapter, disabled by default and requiring a server-managed operator bearer token if enabled. It never supplies control setpoints. Supply secrets via Secret Manager, never browser source or a committed environment file. Enabling Vertex requires an explicit budget/quota decision, `roles/aiplatform.user` on a suitable restricted service account, appropriate model/region access and `EXPLANATION_TOKEN`. The UI intentionally does not collect secrets or expose this private route. Vertex output requires review and has no evidence credit. No image-generation billing or external IP upload is performed by default.

## Submission assets and remaining gates

Use actual dashboard captures, labeled 3D concept exports and source links in the PPT. Separate a concept video from a future physical demonstration. Organizer AI/original-work permission remains a human requirement. The source pack includes disabled-by-default firmware, not a field-ready installation. Real diagnostic actuation, sensor/source/condensation/current instrumentation, physical calibration, hardwired protection, qualification, food recipes, sealed experiments, customer acceptance, signed remote commands, OTA and industrial protocols remain gated. A more impressive dashboard cannot pass those gates.

Public repository scope is this directory only; private research, credentials, raw customer data, local tools and generated binaries must not be published. Third-party code is used through declared packages; retain dependency notices and review licensing before redistribution. No independent patentability or freedom-to-operate conclusion is supplied.
