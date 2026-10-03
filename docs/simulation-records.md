# Simulation records and provenance

ColdFlow simulation runs are immutable JSONL artifacts. The first line is a versioned `SIMULATED` manifest; subsequent lines are samples containing the run identity, configuration and manifest hashes, seed, simulator/contract/model versions, boot identity, time, sequence, input/output hashes, and a provenance-complete advisory label. Each line contains `previousHash` and `recordHash`, forming an append-only SHA-256 chain.

Synthetic labels are produced only by the declared rules in `analysis/labels.mjs`. They are grouped by configuration family and seed and carry `source`, `evidenceClass`, `reason`, `intervention`, `reviewer`, and `custodian`. `SIMULATED` and `REPLAY` artifacts never become `LIVE_TABLETOP` or `FIELD_DATA`; stale, insufficient, contradictory, or replayed-as-live evidence yields `UNKNOWN` or `ABSTAIN`.

## Record and replay

```sh
node scripts/record-simulation.mjs --family normal.v1 --seed 2026 --output artifacts/simulation/run.jsonl
node scripts/replay-simulation.mjs --input artifacts/simulation/run.jsonl --report artifacts/simulation/replay-report.json
```

Replay performs no service calls. It verifies the manifest hash, configuration hash, input/output hashes, sequence, boot identity, and complete append-only chain before producing a deterministic run hash and report hash. Altering any manifest or record fails closed. Artifacts under `artifacts/simulation` are local generated outputs and are not evidence of physical performance or hardware readiness.
