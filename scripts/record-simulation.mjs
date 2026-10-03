import { createManifest, normalizeFamily } from '../recorder/manifest.mjs'
import { writeSimulationRun } from '../recorder/synthetic.mjs'

function options(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue
    const key = argv[index].slice(2)
    values[key] = argv[index + 1]?.startsWith('--') ? true : argv[++index]
  }
  return values
}

const flags = options(process.argv.slice(2))
if (!flags.output) throw new Error('Usage: node scripts/record-simulation.mjs --family normal.v1 --seed 2026 --output artifacts/simulation/run.jsonl')
const manifest = createManifest({ family: normalizeFamily(flags.family ?? 'normal.v1'), seed: Number(flags.seed ?? 2026), durationSeconds: Number(flags.duration ?? 120) })
await writeSimulationRun(flags.output, manifest)
console.log(JSON.stringify({ output: flags.output, anchor: `${flags.output}.anchor.json`, runId: manifest.runId, manifestHash: manifest.manifestHash, recordCount: manifest.durationSeconds }, null, 2))
