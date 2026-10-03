import { replayRun } from '../recorder/replay.mjs'
import { writeFile } from 'node:fs/promises'

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
if (!flags.input || !flags.report) throw new Error('Usage: node scripts/replay-simulation.mjs --input artifacts/simulation/run.jsonl --report artifacts/simulation/replay-report.json')
const result = await replayRun(flags.input)
await writeFile(flags.report, `${JSON.stringify(result.report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ input: flags.input, report: flags.report, runHash: result.canonicalRunHash, reportHash: result.reportHash }, null, 2))
