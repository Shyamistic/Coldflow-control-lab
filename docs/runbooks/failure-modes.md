# Failure modes

- **API or process failure:** use correlation IDs and request/error/latency metrics; Cloud Run may restart the stateless instance. Return to a known-good revision if readiness fails.
- **Replay or manifest failure:** stop the report, preserve the immutable manifest and hash-chain error, and mark the result `UNKNOWN`/`ABSTAIN`; never repair a source run in place.
- **Expired command/lease:** reject or revoke it and remain in safe fallback. The public service has no physical command route.
- **Network loss:** treat missing or stale data as unavailable, abstain, and do not infer blockage or issue control commands.
- **Storage/report failure:** keep the run local to the caller, report failure, and do not claim a persisted result; the service has no durable storage.
- **Cost/rate limit:** inspect Cloud Run quotas, budget alerts, and process-local rate-limit responses. Keep Vertex disabled unless separately approved.
- **Sensor, fault, or advisory path:** preserve simulation provenance and record fault/abstention/advisory metrics; advisory output never has actuator authority.

All recovery decisions retain the simulation label. No physical safety gate is passed by software availability.
