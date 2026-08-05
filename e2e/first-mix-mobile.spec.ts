import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function loadPerformance(page: Page) {
  await page.getByRole('button', { name: 'Use mouse controls instead' }).click()
  await page.getByRole('button', { name: 'Try generated demo tracks' }).click()
  await expect(page.getByText('Neon Pulse', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open performance · 2 tracks' }).click()
}

function silentWav() {
  const sampleRate = 8_000
  const sampleCount = sampleRate
  const bytes = Buffer.alloc(44 + sampleCount * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(sampleCount * 2, 40)
  return bytes
}

test('mobile keeps the camera, air targets, and waveforms usable without zooming out', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Allow private camera' })).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  await loadPerformance(page)
  await expect(page.locator('.uv-performance-stage')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expect(page.locator('.uv-air-rail-a')).toBeInViewport()
  await expect(page.locator('.uv-air-rail-b')).toBeInViewport()

  const airButtons = page.locator('[data-air-target]')
  await expect(airButtons).toHaveCount(7)
  for (let index = 0; index < await airButtons.count(); index += 1) {
    const box = await airButtons.nth(index).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }

  await page.locator('[data-air-target="play:a"]').click()
  await expect(page.locator('[data-air-target="play:a"]')).toContainText('Pause')
  await expect(page.locator('[data-air-target="play:b"]')).toContainText('Start')

  const sync = page.locator('[data-air-target="sync"]')
  await sync.click()
  await expect(sync).toContainText('BPM matched')
  await sync.click()
  await expect(sync).toContainText('Match BPM')

  await page.getByRole('button', { name: 'Manual controls' }).click()
  await expect(page.getByRole('slider')).toHaveCount(4)
  await expectNoHorizontalOverflow(page)
})

test('single-track path enables performance while Deck B stays optional', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Use mouse controls instead' }).click()
  await page.getByLabel('Choose audio for Deck A').setInputFiles({
    name: 'solo.wav',
    mimeType: 'audio/wav',
    buffer: silentWav(),
  })
  const open = page.getByRole('button', { name: 'Open performance · 1 track' })
  await expect(open).toBeEnabled()
  await open.click()
  await expect(page.locator('[data-air-target="play:a"]')).toBeEnabled()
  await expect(page.locator('[data-air-target="play:b"]')).toBeDisabled()
})

test('performance controls reflow at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/')
  await loadPerformance(page)
  await expectNoHorizontalOverflow(page)
  const stage = await page.locator('.uv-performance-stage').boundingBox()
  expect(stage).not.toBeNull()
  expect(stage!.x).toBeGreaterThanOrEqual(0)
  expect(stage!.x + stage!.width).toBeLessThanOrEqual(320)
})

test('desktop setup progress labels remain visible', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  const labels = page.locator('.uv-stepper span')
  await expect(labels).toHaveCount(3)
  for (let index = 0; index < await labels.count(); index += 1) {
    expect(await labels.nth(index).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})
