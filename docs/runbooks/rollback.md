# Rollback runbook

1. Declare the incident and capture the revision, image digest, correlation IDs, and UTC interval; do not copy secrets into the incident.
2. Stop rollout and route traffic to the last known-good immutable revision using Cloud Run traffic controls.
3. Check `/api/live`, `/api/ready`, `/api/health`, and `/api/metrics`; readiness must still show simulation-only and hardware disconnected.
4. Preserve the failing image SBOM, logs, and manifest hashes for review. Do not delete evidence before retention is confirmed.
5. Re-run npm lockfile, application, browser, container, and SBOM checks against the candidate before retrying.

Rollback does not create physical evidence, restore hardware authority, or authorize an actuator route. Escalate if the service remains unavailable or costs/rate limits are abnormal.
