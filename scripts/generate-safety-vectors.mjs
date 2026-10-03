import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourcePath = resolve(root, 'contracts/fixtures/safety-vectors.v1.json')
const targetPath = resolve(root, 'firmware/include/generated/safety_vectors.hpp')
await mkdir(resolve(root, 'firmware/include/generated'), { recursive: true })
const source = JSON.parse(await readFile(sourcePath, 'utf8'))
if (source.schemaVersion !== '1.0' || !Array.isArray(source.vectors)) throw new Error('Unsupported safety vector fixture')
const escape = value => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
const rows = source.vectors.map(vector => `  {"${escape(vector.name)}", "${escape(vector.expectedReason)}", ${vector.permitted ? 'true' : 'false'}}`).join(',\n')
const header = `#pragma once\n#include <cstddef>\n#include <cstdint>\n\nnamespace coldflow::generated {\ninline constexpr char schemaVersion[] = "1.0";\ninline constexpr uint32_t freshnessMs = 2000;\ninline constexpr uint32_t leaseMs = 30000;\ninline constexpr uint32_t shieldMs = 200;\ninline constexpr float maximumDuty = 0.4f;\ninline constexpr float slewDuty = 0.05f;\ninline constexpr float lowTemperatureC = 4.0f;\nstruct SafetyVector { const char* name; const char* expectedReason; bool permitted; };\ninline constexpr SafetyVector safetyVectors[] = {\n${rows}\n};\ninline constexpr std::size_t safetyVectorCount = sizeof(safetyVectors) / sizeof(safetyVectors[0]);\n}\n`
await writeFile(targetPath, header)
