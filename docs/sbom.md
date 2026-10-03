# Software bill of materials

The dependency lockfile is the source of reproducibility. Build with Node 24 and `npm ci`; do not use `npm install` in CI or deployment builds. Generate the CycloneDX report locally or in CI with:

```sh
mkdir -p artifacts
npm sbom --sbom-format=cyclonedx > artifacts/sbom.json
```

Review the generated file as a build artifact, retain it with the image digest, and run the organization's license policy scanner against its component list. No generated SBOM or image is committed. A release is blocked if the lockfile changes unexpectedly, a required license is not approved, or the image digest cannot be tied to the source revision.
