# Secrets and cost controls

Do not commit tokens, service-account keys, `.env` files, customer data, or request bodies. If the optional Vertex explanation adapter is enabled, store its operator token in Secret Manager, grant only the runtime service account's required role, and keep `ENABLE_VERTEX` explicit. It remains disabled by default and cannot issue actuator commands.

Use Cloud Run max instances, request concurrency, timeout, quotas, and budget alerts as deployment controls. The Express limiter is process-local and is not a spending guarantee. Review Cloud Run, Artifact Registry, build, logging, and egress charges after each deployment. Rotate and revoke exposed credentials immediately, then redeploy from a clean immutable build.
