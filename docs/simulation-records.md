# Simulation records and provenance

ColdFlow simulation runs are immutable JSONL artifacts. The first line is a versioned `SIMULATED` manifest; subsequent lines are samples containing the run identity, configuration and manifest hashes, seed, simulator/contract/model versions, boot identity, time, sequence, input/output hashes, and a provenance-complete advisory label. Each line contains `previousHash` and `recordHash`, forming an append-only SHA-256 chain.

Synthetic labels are produced only by the declared rules in `analysis/labels.mjs`. They are grouped by configuration family and seed and carry `source`, `evidenceClass`, `reason`, `intervention`, `reviewer`, and `custodian`. `SIMULATED` and `REPLAY` artifacts never become `LIVE_TABLETOP` or `FIELD_DATA`; stale, insufficient, contradictory, or replayed-as-live evidence yields `UNKNOWN` or `ABSTAIN`.

## Record and replay

```sh
node scripts/record-simulation.mjs --family normal.v1 --seed 2026 --output artifacts/simulation/run.jsonl
node scripts/replay-simulation.mjs --input artifacts/simulation/run.jsonl --report artifacts/simulation/replay-report.json
```

The recorder also writes a separate `run.jsonl.anchor.json` trusted-run anchor. Release replay must retain that digest independently (or pass another external anchor with `--anchor`); the sidecar is a local convenience, not a cryptographic signature. The anchor authenticates the manifest/configuration identity and the canonical per-sequence request schedule, while the JSONL chain authenticates record order and each stored hash. Replay compares every stored input byte-for-byte with that derived schedule, regenerates the canonical `VirtualDevice` output and label, and rejects coordinated input/manifest/label rewrites when the retained anchor is unchanged. What remains simulation-only is the plant assumptions, synthetic labels, and all physical/hardware conclusions.

A release manifest binds the replay manifest, replay report, and trusted anchor together with the source commit, package-lock hash, evaluation report, model decision/artifact, SBOM/license result, immutable image digest, and five route checks. Keep those generated files under ignored `artifacts/`; they are reproducibility inputs, not signatures, physical ground truth, or custody records.
