import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const DEPLOYMENT_VERIFICATION_SCHEMA = 'coldflow.deployment-verification.v1'
export const DEPLOYMENT_ROUTES = ['live', 'ready', 'health', 'metrics', 'experiments']
const COMMIT = /^[a-f0-9]{40}$/
const DIGEST = /^sha256:[a-f0-9]{64}$/
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const SOURCE_LABELS = ['coldflow/source-revision', 'coldflow.source-revision', 'source-revision', 'org.opencontainers.image.revision']

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validDate = value => typeof value === 'string' && DATE.test(value) && !Number.isNaN(Date.parse(value))
const imageDigest = reference => typeof reference === 'string' ? reference.match(/@(sha256:[a-f0-9]{64})$/)?.[1] ?? null : null
const routeMap = value => isObject(value?.routes) ? value.routes : value

function sourceRevisionMetadata(describe) {
  const locations = [
    ['metadata.labels', describe?.metadata?.labels],
    ['spec.template.metadata.labels', describe?.spec?.template?.metadata?.labels],
    ['metadata.annotations', describe?.metadata?.annotations],
    ['spec.template.metadata.annotations', describe?.spec?.template?.metadata?.annotations],
  ]
  for (const [location, values] of locations) {
    if (!isObject(values)) continue
    for (const key of SOURCE_LABELS) if (typeof values[key] === 'string' && values[key]) return { key, location, value: values[key] }
  }
  return null
}

function trafficRevision(describe) {
  const latestReady = describe?.status?.latestReadyRevisionName
  const traffic = Array.isArray(describe?.status?.traffic) ? describe.status.traffic : null
  if (!traffic) return latestReady ?? null
  const fullTraffic = traffic.filter(item => Number(item?.percent) === 100 && (typeof item?.revisionName === 'string' || item?.latestRevision === true))
  if (fullTraffic.length !== 1) return null
  return fullTraffic[0].revisionName ?? latestReady ?? null
}

export function validateRouteChecks(routes, { revision } = {}) {
  const errors = []
  const checks = routeMap(routes)
  if (!isObject(checks)) return { valid: false, errors: ['deployment routes are required'] }
  for (const route of DEPLOYMENT_ROUTES) {
    const check = checks[route]
    if (!isObject(check)) { errors.push(`deployment.routes.${route} is required`); continue }
    if (check.status !== 'passed' || !Number.isInteger(check.statusCode) || check.statusCode < 200 || check.statusCode > 299) errors.push(`deployment.routes.${route} must be a passed 2xx check`)
    if (!validDate(check.verifiedAt)) errors.push(`deployment.routes.${route}.verifiedAt must be an ISO UTC timestamp`)
    if (typeof check.revision !== 'string' || !check.revision) errors.push(`deployment.routes.${route}.revision is required`)
    else if (revision && check.revision !== revision) errors.push(`deployment.routes.${route}.revision does not match deployed revision`)
    for (const key of Object.keys(check)) if (!['status', 'statusCode', 'revision', 'verifiedAt', 'url'].includes(key)) errors.push(`deployment.routes.${route}.${key} is not allowed by the deployment schema`)
  }
  for (const key of Object.keys(checks)) if (!DEPLOYMENT_ROUTES.includes(key)) errors.push(`deployment.routes.${key} is not allowed by the deployment schema`)
  return { valid: errors.length === 0, errors }
}

export function validateDeploymentVerification(value, { service, region, sourceRevision, imageDigest: expectedDigest, revision } = {}) {
  const errors = []
  if (!isObject(value)) return { valid: false, errors: ['deployment verification must be an object'] }
  if (value.schema !== DEPLOYMENT_VERIFICATION_SCHEMA) errors.push(`schema must be ${DEPLOYMENT_VERIFICATION_SCHEMA}`)
  for (const key of ['service', 'region', 'revision', 'imageReference', 'imageDigest', 'sourceRevision', 'sourceRevisionLabel', 'describe', 'verifiedAt', 'routes']) if (!(key in value)) errors.push(`deployment verification.${key} is required`)
  if (typeof value.service !== 'string' || !value.service || /placeholder|project[_-]?id|unresolved|local/i.test(value.service)) errors.push('deployment verification.service must be resolved')
  if (typeof value.region !== 'string' || !value.region || /placeholder|project[_-]?id|unresolved|local/i.test(value.region)) errors.push('deployment verification.region must be resolved')
  if (typeof service === 'string' && value.service !== service) errors.push('deployed service does not match requested service')
  if (typeof region === 'string' && value.region !== region) errors.push('deployed region does not match requested region')
  if (typeof value.revision !== 'string' || !value.revision || /placeholder|unresolved|local/i.test(value.revision)) errors.push('deployment verification.revision must be resolved')
  if (revision && value.revision !== revision) errors.push('deployed revision does not match requested revision')
  if (typeof value.imageReference !== 'string' || !value.imageReference) errors.push('deployment verification.imageReference is required')
  if (!DIGEST.test(value.imageDigest ?? '')) errors.push('deployment verification.imageDigest must be an immutable sha256 digest')
  if (!COMMIT.test(value.sourceRevision ?? '')) errors.push('deployment verification.sourceRevision must be a full commit hash')
  if (expectedDigest && value.imageDigest !== expectedDigest) errors.push('deployed image digest does not match built image digest')
  if (sourceRevision && value.sourceRevision !== sourceRevision) errors.push('deployed source revision does not match reviewed source commit')
  if (!isObject(value.sourceRevisionLabel) || typeof value.sourceRevisionLabel.key !== 'string' || typeof value.sourceRevisionLabel.location !== 'string') errors.push('deployment verification.sourceRevisionLabel must identify the resolved Cloud Run label or metadata')
  if (!isObject(value.describe) || typeof value.describe.path !== 'string' || !value.describe.path || !/^[a-f0-9]{64}$/.test(value.describe.sha256 ?? '')) errors.push('deployment verification.describe must identify the exact Cloud Run describe output')
  if (!validDate(value.verifiedAt)) errors.push('deployment verification.verifiedAt must be an ISO UTC timestamp')
  errors.push(...validateRouteChecks(value.routes, { revision: value.revision }).errors)
  return { valid: errors.length === 0, errors }
}

export function resolveCloudRunDeployment(describe, { service, region, sourceRevision, imageDigest: expectedDigest, revision: expectedRevision, describePath, describeHash, verifiedAt = new Date().toISOString(), routes } = {}) {
  const errors = []
  if (!isObject(describe)) errors.push('Cloud Run describe output must be a JSON object')
  if (typeof service !== 'string' || !service) errors.push('service is required')
  if (typeof region !== 'string' || !region) errors.push('region is required')
  if (!COMMIT.test(sourceRevision ?? '')) errors.push('sourceRevision must be a full commit hash')
  if (!DIGEST.test(expectedDigest ?? '')) errors.push('imageDigest must be an immutable sha256 digest')
  const actualService = describe?.metadata?.name
  if (actualService !== service) errors.push(`Cloud Run service describe name does not match requested service: ${actualService ?? 'missing'}`)
  const imageReference = describe?.spec?.template?.spec?.containers?.[0]?.image
  const actualDigest = imageDigest(imageReference)
  if (!actualDigest) errors.push('Cloud Run describe output must contain a digest-pinned container image')
  else if (actualDigest !== expectedDigest) errors.push('deployed image digest does not match built image digest')
  const actualRevision = trafficRevision(describe)
  if (!actualRevision) errors.push('Cloud Run describe output must identify one 100% traffic revision or latestReadyRevisionName')
  if (describe?.status?.latestReadyRevisionName && actualRevision && describe.status.latestReadyRevisionName !== actualRevision) errors.push('Cloud Run traffic revision does not match latest ready revision')
  if (expectedRevision && actualRevision !== expectedRevision) errors.push('deployed revision does not match requested revision')
  const source = sourceRevisionMetadata(describe)
  if (!source) errors.push('Cloud Run describe output is missing the coldflow source-revision label or metadata')
  else if (source.value !== sourceRevision) errors.push('deployed source revision label does not match reviewed source commit')
  const routeResult = validateRouteChecks(routes, { revision: actualRevision })
  errors.push(...routeResult.errors)
  if (errors.length) throw new Error(`Cloud Run deployment verification failed: ${errors.join('; ')}`)
  const verification = {
    schema: DEPLOYMENT_VERIFICATION_SCHEMA,
    service: actualService,
    region,
    revision: actualRevision,
    imageReference,
    imageDigest: actualDigest,
    sourceRevision: source.value,
    sourceRevisionLabel: { key: source.key, location: source.location },
    describe: { path: describePath, sha256: describeHash },
    verifiedAt,
    routes: routeMap(routes),
  }
  const result = validateDeploymentVerification(verification, { service, region, sourceRevision, imageDigest: expectedDigest, revision: expectedRevision })
  if (!result.valid) throw new Error(`Cloud Run deployment verification failed: ${result.errors.join('; ')}`)
  return verification
}

export function sha256FileBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue
    const [key, inline] = argv[index].slice(2).split('=', 2)
    flags[key] = inline ?? argv[++index]
  }
  return flags
}

async function json(path) { return JSON.parse(await readFile(path, 'utf8')) }

export async function main(argv = process.argv.slice(2)) {
  const flags = parseFlags(argv)
  const describePath = flags.describe
  const routesPath = flags.routes ?? flags['route-checks']
  const output = flags.output ?? 'artifacts/release/deployment-checks.json'
  if (!describePath) throw new Error('--describe is required; pass the exact gcloud run services describe --format=json output')
  if (!routesPath) throw new Error('--routes is required; each route check must include the deployed revision')
  if (!output.split(/[\\/]/).includes('artifacts')) throw new Error('deployment verification output must remain under ignored artifacts/')
  const describeBytes = await readFile(describePath)
  const describe = JSON.parse(describeBytes.toString('utf8'))
  const routes = await json(routesPath)
  const verification = resolveCloudRunDeployment(describe, {
    service: flags.service ?? flags['cloud-run-service'],
    region: flags.region ?? flags['cloud-run-region'],
    sourceRevision: flags['source-commit'],
    imageDigest: flags['image-digest'],
    revision: flags.revision ?? flags['cloud-run-revision'],
    describePath,
    describeHash: sha256FileBytes(describeBytes),
    verifiedAt: flags['verified-at'] ?? new Date().toISOString(),
    routes,
  })
  await mkdir(dirname(resolve(output)), { recursive: true })
  await writeFile(resolve(output), `${JSON.stringify(verification, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ output, service: verification.service, region: verification.region, revision: verification.revision, imageDigest: verification.imageDigest, sourceRevision: verification.sourceRevision }))
  return verification
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll('\\', '/').split('/').at(-1))) await main()
