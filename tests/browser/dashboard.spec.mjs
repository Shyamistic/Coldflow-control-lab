import { test, expect } from '@playwright/test'
import { mkdir, stat, readFile } from 'node:fs/promises'
const folder = 'artifacts/browser'
test.beforeAll(() => mkdir(folder, { recursive: true }))
const pixelSignature = page => page.locator('.scene canvas').evaluate(source => {
  const copy = document.createElement('canvas'); copy.width = 180; copy.height = 120
  const context = copy.getContext('2d'); context.drawImage(source, 0, 0, 180, 120)
  const pixels = context.getImageData(0, 0, 180, 120).data
  let hash = 0; const colors = new Set()
  for (let index = 0; index < pixels.length; index += 16) { hash = (hash * 31 + pixels[index] + pixels[index + 1]) >>> 0; colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`) }
  return { hash, colors: colors.size }
})
for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`${viewport.name}: scene, safety, traces, exports and comparators`, async ({ page }) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize(viewport); await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Chamber overview' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Play simulation', exact: true })).toBeDisabled()
    await expect.poll(async () => (await pixelSignature(page)).colors).toBeGreaterThan(30)
    await expect(page.locator('.zone-label')).toHaveCount(6)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Approve simulated lease' }).click()
    const before = (await pixelSignature(page)).hash
    await page.getByRole('button', { name: 'Play simulation', exact: true }).click()
    await expect.poll(async () => (await pixelSignature(page)).hash).not.toBe(before)
    await expect.poll(async () => Number(await page.getByLabel('Simulation time').inputValue())).toBeGreaterThan(2)
    await page.getByRole('button', { name: 'Pause simulation', exact: true }).click()
    await page.screenshot({ path: `${folder}/${viewport.name}.png`, fullPage: true })
    const pngDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG', exact: true }).click(); const png = await pngDownload; await png.saveAs(`${folder}/${viewport.name}-concept.png`); expect((await stat(`${folder}/${viewport.name}-concept.png`)).size).toBeGreaterThan(10000)
    const csvDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export CSV' }).click(); const csv = await csvDownload; await csv.saveAs(`${folder}/${viewport.name}.csv`); expect(await readFile(`${folder}/${viewport.name}.csv`, 'utf8')).toContain('SIMULATION,partial,identified')
    await page.getByLabel('Source context').selectOption('DEFROST'); await expect(page.locator('.safety-strip')).toContainText('ADDED MOTION INHIBITED'); await expect(page.getByRole('button', { name: 'Play simulation', exact: true })).toBeDisabled()
    await page.getByLabel('Source context').selectOption('NORMAL'); await page.getByRole('button', { name: 'Software cutout', exact: true }).click(); await expect(page.getByRole('button', { name: 'Reset software cutout' })).toBeVisible(); await page.getByRole('button', { name: 'Reset software cutout' }).click()
    await page.getByLabel('Scenario', { exact: true }).selectOption('blocked'); await page.getByRole('button', { name: 'Approve simulated lease' }).click(); await expect(page.locator('.safety-strip')).toContainText('ABSTAIN')
    await page.getByRole('button', { name: 'Experiments', exact: true }).click(); await page.getByRole('button', { name: 'Run comparators' }).click(); await expect(page.locator('tbody tr')).toHaveCount(5); await expect(page.locator('tbody')).toContainText('Physical path-clear')
    await page.getByRole('button', { name: 'Model & boundaries', exact: true }).click(); await page.getByRole('button', { name: 'Request explanation' }).click(); await expect(page.locator('.explanation')).toContainText('cannot diagnose restacking')
    expect(errors).toEqual([])
  })
}
test('video capture exports a labeled moving concept clip', async ({ page }) => {
  await page.goto('/'); await expect.poll(async () => (await pixelSignature(page)).colors).toBeGreaterThan(30)
  await page.getByRole('button', { name: 'Approve simulated lease' }).click()
  await page.getByRole('button', { name: 'Video', exact: true }).click()
  await expect.poll(async () => Number(await page.getByLabel('Simulation time').inputValue())).toBeGreaterThan(8)
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Stop', exact: true }).click(); const clip = await pending; await clip.saveAs(`${folder}/concept-SIMULATION.webm`)
  expect((await stat(`${folder}/concept-SIMULATION.webm`)).size).toBeGreaterThan(10000)
})