import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { evaluateSimulation, parseEvaluationArguments } from '../analysis/evaluation.mjs'

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseEvaluationArguments(argumentsList)
  const report = evaluateSimulation(options)
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`Wrote ${options.output}: ${report.groups.length} groups, ${report.cases.length} comparator cases, ${report.faults.resolved}/${report.faults.total} faults resolved\n`)
  return report
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').at(-1))) await main()
