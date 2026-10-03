import { readFile } from 'node:fs/promises'

const path = process.argv[2] ?? 'artifacts/sbom.json'
const buffer = await readFile(path)
const text = (buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8')).replace(/^\uFEFF/, '')
const bom = JSON.parse(text)
if (bom.bomFormat !== 'CycloneDX' || !Array.isArray(bom.components) || bom.components.length === 0) throw new Error('SBOM is not a non-empty CycloneDX component inventory')

const licensesFor = component => (component.licenses ?? []).map(entry => entry.license?.id ?? entry.license?.name ?? entry.expression).filter(Boolean)
const unlicensed = bom.components.filter(component => licensesFor(component).length === 0).map(component => component.name)
const prohibited = bom.components.flatMap(component => licensesFor(component).filter(license => /(?:^|[- ])(?:AGPL|GPL|SSPL|BUSL)(?:[- .]|$)/i.test(license)).map(license => `${component.name}: ${license}`))
if (prohibited.length > 0) throw new Error(`SBOM license policy rejected copyleft or source-available licenses: ${prohibited.join(', ')}`)

console.log(JSON.stringify({ policy: 'permissive-dependencies-no-copyleft', components: bom.components.length, undeclaredLicenses: unlicensed, checked: true }))
