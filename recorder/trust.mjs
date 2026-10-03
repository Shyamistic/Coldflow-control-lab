import { canonicalInputScheduleHash, hashCanonical } from './manifest.mjs'

export const TRUSTED_ANCHOR_SCHEMA = 'coldflow.trusted-run-anchor.v1'

export function createTrustedAnchor(manifest) {
  const unsigned = {
    schema: TRUSTED_ANCHOR_SCHEMA,
    schemaVersion: '1.0',
    runId: manifest.runId,
    family: manifest.family,
    seed: manifest.seed,
    durationSeconds: manifest.durationSeconds,
    manifestHash: manifest.manifestHash,
    configHash: manifest.configHash,
    simulatorManifestHash: manifest.simulatorManifestHash,
    simulatorVersion: manifest.simulatorVersion,
    canonicalInputScheduleHash: canonicalInputScheduleHash(manifest),
    trustStatement: 'This digest is an external local simulation-release anchor; it authenticates the declared manifest and canonical request schedule only.',
  }
  return { ...unsigned, anchorDigest: hashCanonical(unsigned) }
}

export function assertTrustedAnchor(anchor, manifest) {
  if (!anchor || anchor.schema !== TRUSTED_ANCHOR_SCHEMA || anchor.schemaVersion !== '1.0') throw new Error('Trusted replay anchor is missing or invalid')
  const { anchorDigest, ...unsigned } = anchor
  if (!anchorDigest || hashCanonical(unsigned) !== anchorDigest) throw new Error('Trusted replay anchor digest mismatch')
  const expected = createTrustedAnchor(manifest)
  if (anchorDigest !== expected.anchorDigest || anchor.manifestHash !== manifest.manifestHash || anchor.runId !== manifest.runId || anchor.canonicalInputScheduleHash !== expected.canonicalInputScheduleHash) throw new Error('Trusted replay anchor does not match canonical manifest')
  return anchor
}
