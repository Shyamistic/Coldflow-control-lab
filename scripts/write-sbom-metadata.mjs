import { readFile, writeFile } from 'node:fs/promises'

const [sbomPath = 'artifacts/sbom.json', outputPath = 'artifacts/sbom-metadata.json', imageRef = 'coldflow-simulation:local', imageId = 'unbuilt'] = process.argv.slice(2)
const buffer = await readFile(sbomPath)
const bomText = buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8')
const bom = JSON.parse(bomText.replace(/^\uFEFF/, ''))
const metadata = {
  schema: 'coldflow.sbom-evidence.v1',
  sourceRevision: process.env.GITHUB_SHA ?? 'local',
  image: { ref: imageRef, id: imageId },
  sbom: { path: sbomPath, serialNumber: bom.serialNumber, componentCount: bom.components?.length ?? 0, format: bom.bomFormat, specVersion: bom.specVersion },
}
await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(metadata))
