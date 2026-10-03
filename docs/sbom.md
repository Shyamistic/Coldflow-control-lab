# Software bill of materials

The dependency lockfile is the source of reproducibility. Build with Node 24 and `npm ci`; do not use `npm install` in CI or deployment builds. Generate the CycloneDX report locally or in CI with:

```sh
mkdir -p artifacts
npm sbom --sbom-format=cyclonedx > artifacts/sbom.json
node scripts/check-sbom.mjs artifacts/sbom.json
node scripts/write-sbom-metadata.mjs artifacts/sbom.json artifacts/sbom-metadata.json coldflow-simulation:local local
```

Review the generated `artifacts/sbom.json` and `artifacts/sbom-metadata.json` as build artifacts, retain them with the image ID and source revision, and run the organization's license policy scanner against the component list. The repository gate rejects GPL/AGPL/SSPL/BUSL dependencies and reports components without declared licenses for organization review. No generated SBOM or image is committed. A release is blocked if the lockfile changes unexpectedly, a required license is not approved, an undeclared license is not cleared by the organization's scanner, or the image identity cannot be tied to the source revision.
