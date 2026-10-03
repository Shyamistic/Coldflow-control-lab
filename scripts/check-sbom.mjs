import { readFile } from 'node:fs/promises'

const path = process.argv[2] ?? 'artifacts/sbom.json'
const allowlistPath = process.argv[3] ?? 'docs/license-allowlist.json'
const resultPath = process.argv[4]
const decodeJson = buffer => {
  let text = buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return JSON.parse(text)
}
const bom = decodeJson(await readFile(path))
const allowlist = decodeJson(await readFile(allowlistPath))
if (bom.bomFormat !== 'CycloneDX' || !Array.isArray(bom.components) || bom.components.length === 0) throw new Error('SBOM is not a non-empty CycloneDX component inventory')
if (allowlist.schema !== 'coldflow.license-review.v1' || !Array.isArray(allowlist.decisions)) throw new Error('License review allowlist is missing or invalid')

const licensesFor = component => (component.licenses ?? []).map(entry => entry.license?.id ?? entry.license?.name ?? entry.expression).filter(Boolean)
const unlicensed = bom.components.filter(component => licensesFor(component).length === 0)
const decisions = new Map(allowlist.decisions.map(decision => [`${decision.name}@${decision.version}`, decision]))
const unresolved = unlicensed.filter(component => {
  const decision = decisions.get(`${component.name}@${component.version}`)
  return !decision || decision.decision !== 'reviewed-approved' || !decision.reviewer || !decision.reviewedAt || !decision.rationale || !decision.evidence
}).map(component => `${component.name}@${component.version}`)
if (unresolved.length > 0) throw new Error(`SBOM license policy rejected undeclared or unapproved licenses: ${unresolved.join(', ')}; add an exact reviewed decision to ${allowlistPath}`)
const prohibited = bom.components.flatMap(component => licensesFor(component).filter(license => /(?:^|[- ])(?:AGPL|GPL|SSPL|BUSL)(?:[- .]|$)/i.test(license)).map(license => `${component.name}: ${license}`))
if (prohibited.length > 0) throw new Error(`SBOM license policy rejected copyleft or source-available licenses: ${prohibited.join(', ')}`)

const result = { policy: 'permissive-dependencies-with-explicit-license-review', components: bom.components.length, undeclaredLicenses: unlicensed.map(component => `${component.name}@${component.version}`), approvedUndeclaredLicenses: unlicensed.map(component => `${component.name}@${component.version}`), allowlist: allowlistPath, checked: true }
if (resultPath) await (await import('node:fs/promises')).writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result))
