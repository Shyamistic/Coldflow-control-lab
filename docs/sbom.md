# Software bill of materials

The dependency lockfile is the source of reproducibility. Build with Node 24 and `npm ci`; do not use `npm install` in CI or deployment builds. Generate the CycloneDX report locally or in CI with:

```sh
mkdir -p artifacts
npm sbom --sbom-format=cyclonedx > artifacts/sbom.json
node scripts/check-sbom.mjs artifacts/sbom.json docs/license-allowlist.json
node scripts/write-sbom-metadata.mjs artifacts/sbom.json artifacts/sbom-metadata.json coldflow-simulation:local local
```

A complete software release gate is `npm ci`, `npm test`, `npm run lint`, `npm run build`, `npm run evaluate:simulation`, `npm run test:e2e`, record/replay verification, advisory-model evaluation, SBOM/license checking, and Docker build/smoke when Docker is available. Native g++ and PlatformIO jobs are toolchain-only additions. Record each passed command and its UTC completion time for the release manifest; a generated report is evidence of the software checks only, never physical readiness.

```sh
npm sbom --sbom-format=cyclonedx > artifacts/sbom.json
node scripts/check-sbom.mjs artifacts/sbom.json docs/license-allowlist.json artifacts/sbom-check.json
```

## External release evidence

The release manifest is deliberately generated only after the source commit, immutable image, deployment revision and all evidence exist. It is written under ignored `artifacts/` and contains no self-hash. The command-results input records passed `npm test`, lint, build, evaluation, replay, SBOM and Docker commands; the other inputs bind the raw hashes for evaluation, ML decision/candidate, replay JSONL/report/trusted anchor, SBOM/license result, image digest and Cloud Run route checks.

```sh
node scripts/create-release-manifest.mjs \
  --commands artifacts/release/command-results.json \
  --evaluation artifacts/simulation/evaluation.json \
  --model-decision ml/decision-record.json \
  --model-artifact artifacts/ml/candidate.json \
  --replay-manifest artifacts/simulation/run.jsonl \
  --replay-report artifacts/simulation/replay-report.json \
  --trusted-anchor artifacts/simulation/run.jsonl.anchor.json \
  --sbom artifacts/sbom.json \
  --license-result artifacts/sbom-check.json \
  --image-reference REGION-docker.pkg.dev/PROJECT/REPOSITORY/coldflow-simulation@sha256:DIGEST \
  --image-digest sha256:DIGEST \
  --image-source-commit COMMIT \
  --cloud-run-service coldflow-simulation \
  --cloud-run-revision REVISION \
  --deployment-checks artifacts/release/deployment-checks.json
```

`COMMIT`, `DIGEST`, `REVISION`, deployment routes and timestamps must be real resolved values; `local`, `unbuilt`, placeholders and unresolved identities are rejected. This manifest is reproducibility evidence for the software simulation only. Native C++ and PlatformIO results remain CI/toolchain-only, and no generated evidence or manifest claims assembled hardware or physical readiness.
