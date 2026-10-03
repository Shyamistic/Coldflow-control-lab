# Simulation operations

ColdFlow is a stateless, simulation-labelled Cloud Run service. It stores no runs or customer data. Every request receives an `X-Correlation-ID`; structured JSON logs include that ID, `SIMULATION` evidence, `SIMULATED` execution provenance, configuration version, route, status, and bounded latency. Logs must never include request bodies, bearer tokens, API keys, or raw secrets.

`/api/live` answers process liveness only. `/api/ready` answers whether the stateless simulation service can serve requests and always reports `hardwareConnected: false` and `physicalGatesPassed: []`. `/api/health` preserves the public compatibility response. `/api/metrics` exposes bounded process-local counters for requests, errors, latency, replay, fault, abstention, expiry, and advisory events; metrics are not durable billing or audit records.

Deploy immutable image digests with `deploy/cloud-run-simulation.yaml`, keep min instances at zero and max instances at one unless an approved cost review says otherwise, and keep Vertex disabled. Rate limiting is process-local, so Cloud Run quotas and budget alerts are also required. Verify the revision, readiness response, simulation label, and absence of physical routes after deployment.
