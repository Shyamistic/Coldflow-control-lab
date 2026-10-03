import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const unitOnly = process.argv.includes('--unit-only')
const nodeTests = [
  'tests/contracts.test.ts',
  'tests/domain.test.ts',
  'tests/simulator.test.ts',
  'tests/virtual-device.test.ts',
  'tests/hil.test.mjs',
  'tests/control-validation.test.mjs',
  'tests/evaluation.test.mjs',
  'tests/ground-truth.test.mjs',
  'tests/recorder.test.mjs',
  'tests/replay.test.mjs',
  'tests/ml.test.mjs',
  'tests/observability.test.mjs',
  'tests/api.test.mjs',
  'tests/public-experiment.test.ts',
  'tests/release-evidence.test.mjs',
]

const node = process.platform === 'win32' ? 'node' : process.execPath
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const quoteWindows = value => /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
    const windowsCommand = process.platform === 'win32' ? 'cmd.exe' : command
    const windowsArgs = process.platform === 'win32' ? ['/d', '/s', '/c', [command, ...args].map(quoteWindows).join(' ')] : args
    const child = spawn(windowsCommand, windowsArgs, { cwd: root, env: process.env, stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`)))
  })
}

await run(node, ['scripts/evaluate-simulation.mjs', '--output', 'artifacts/simulation/evaluation.json'])
if (!unitOnly) await run(npm, ['run', 'build'])
await run(node, ['--experimental-strip-types', '--test', ...nodeTests])
if (!unitOnly) await run(npx, ['--no-install', 'playwright', 'test'])
