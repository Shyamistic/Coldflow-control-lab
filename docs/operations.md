# Simulation operations

ColdFlow is a stateless, simulation-labelled Cloud Run service. It stores no runs or customer data. Every request receives an `X-Correlation-ID`; structured JSON logs include that ID, `SIMULATION` evidence, `SIMULATED` execution provenance, configuration version, route, status, and bounded latency. Logs must never include request bodies, bearer tokens, API keys, or raw secrets.

## Public routes

- `GET /api/live` is process liveness only.
- `GET /api/ready` reports service readiness and must report `hardwareConnected: false`, `physicalGatesPassed: []`, and `actuatorAuthority: false`.
- `GET /api/health` is the compatibility health response and reports `SIMULATION` plus no physical gates.
- `GET /api/metrics` exposes bounded process-local counters; it is not durable billing or audit data.
- `POST /api/experiments` accepts the strict `{ scenario, method, duration, seed }` schema and uses the canonical `VERSIONED_PLANT_VIRTUAL_DEVICE` path. Supported scenarios are `partial`, `blocked`, `capacity`, `sensor`, `actuator`, `normal`, and `correctable`; supported methods are `identified`, `fixed-normal`, `fixed-high`, `expert-rule`, and `path-clear`.
- `POST /api/explain` is deterministic interpretation only. Optional `/api/vertex-explain` is disabled by default and remains explanation-only.

Unknown `/api` paths return 404; there is no physical command or actuator route. The legacy domain facade is compatibility-only and must not be described as a separate canonical path.

## Deployment and verification

Deploy an immutable image digest with `deploy/cloud-run-simulation.yaml`, keep min instances at zero and max instances at one unless an approved cost review says otherwise, and keep Vertex disabled. Rate limiting is process-local, so Cloud Run quotas and budget alerts are also required. Do not use placeholder project, region, image, or revision values.

After deployment, record the resolved service revision, image digest, source commit, and UTC verification time. Check all five release routes and retain status/HTTP status in `artifacts/release/deployment-checks.json`:

```sh
$BASE/api/live
$BASE/api/ready
$BASE/api/health
$BASE/api/metrics
POST $BASE/api/experiments
```

The experiment check should use a small valid request such as `{"scenario":"correctable","method":"identified","duration":10,"seed":2026}` and verify a JSON response containing `SIMULATION` compatibility evidence and canonical provenance. Never include tokens or request bodies in logs or public evidence. A route check proves service behavior only; it does not establish hardware, production, food, energy, field, or certification outcomes.

The release manifest is generated only after the exact source commit, evaluation/replay evidence, SBOM/license result, immutable image, deployment revision, and all checks exist. It binds those values without embedding a self-hash and remains ignored generated evidence under `artifacts/`.
