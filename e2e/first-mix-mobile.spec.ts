import { expect, test, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth,
  )).toBe(true)
}

async function openDemoPerformance(page: Page) {
  await page.getByRole('button', { name: 'Use demo instead' }).click()
  await expect(page.getByRole('heading', { name: 'Load your tracks' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to Perform' }).click()
  await expect(page.getByRole('region', { name: 'Deck A control' })).toBeVisible()
}

test('mobile camera-first performance stays usable without zooming out', async ({ page }) => {
  await page.goto('/')

  const allowCamera = page.getByRole('button', { name: 'Allow camera' })
  await expect(allowCamera).toBeVisible()
  await expect(allowCamera).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  const progress = page.getByRole('navigation', { name: 'DJ Room setup' })
  await expect(progress.getByRole('button')).toHaveCount(3)
  await expect(progress.getByRole('button', { name: 'Load Tracks' })).toBeDisabled()
  await expect(progress.getByRole('button', { name: 'Perform' })).toBeDisabled()

  await openDemoPerformance(page)
  await expectNoHorizontalOverflow(page)

  const camera = page.locator('.uv-camera-shell')
  const waveforms = page.locator('.uv-waveform-stack')
  for (const element of [camera, waveforms]) {
    const box = await element.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  }

  const targets = page.locator('.uv-performance-target')
  await expect(targets).toHaveCount(6)
  for (let index = 0; index < await targets.count(); index += 1) {
    const box = await targets.nth(index).boundingBox()
    expect(box, `performance target ${index + 1} should have a layout box`).not.toBeNull()
    expect(box!.height, `performance target ${index + 1} touch height`).toBeGreaterThanOrEqual(44)
  }

  await page.getByRole('button', { name: /Play Deck A/ }).click()
  await page.getByRole('button', { name: /Play Deck B/ }).click()
  await expect.poll(() => page.locator('audio').evaluateAll((audio) =>
    audio.length === 2 && audio.every((track) => !(track as HTMLAudioElement).paused),
  )).toBe(true)

  const sync = page.getByRole('button', { name: 'Toggle BPM Sync' })
  await expect(sync).toHaveCount(1)
  await sync.click()
  await expect(sync).toHaveAttribute('aria-pressed', 'true')
  await sync.click()
  await expect(sync).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: /Cue Deck A/ }).click()
  await expect.poll(() => page.locator('audio').first().evaluate((audio) => ({
    paused: (audio as HTMLAudioElement).paused,
    currentTime: (audio as HTMLAudioElement).currentTime,
  }))).toEqual({ paused: true, currentTime: 0 })
})

test('performance controls reflow at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Allow camera' })).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  await openDemoPerformance(page)
  const camera = await page.locator('.uv-camera-shell').boundingBox()
  const waveforms = await page.locator('.uv-waveform-stack').boundingBox()
  expect(camera).not.toBeNull()
  expect(waveforms).not.toBeNull()
  expect(camera!.x + camera!.width).toBeLessThanOrEqual(320)
  expect(waveforms!.x + waveforms!.width).toBeLessThanOrEqual(320)
  await expectNoHorizontalOverflow(page)
})

test('desktop setup and both waveforms fit the 720p performance viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')

  const progressLabels = page.locator('.uv-flow-progress button span')
  await expect(progressLabels).toHaveCount(3)
  for (let index = 0; index < await progressLabels.count(); index += 1) {
    const label = progressLabels.nth(index)
    expect(
      await label.evaluate((element) => element.scrollWidth <= element.clientWidth),
      `progress label ${index + 1} should not be visually truncated`,
    ).toBe(true)
  }

  await openDemoPerformance(page)
  const stack = await page.locator('.uv-waveform-stack').boundingBox()
  expect(stack).not.toBeNull()
  expect(stack!.y + stack!.height).toBeLessThanOrEqual(720)
  await expectNoHorizontalOverflow(page)
})
