import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth,
  )).toBe(true)
}

test('mobile first mix keeps stage controls reachable without zooming out', async ({ page }) => {
  await page.goto('/')

  const demo = page.getByRole('button', { name: 'Load instant demo' })
  await expect(demo).toBeVisible()
  await expect(demo).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  const pendingSteps = page.locator('.first-mix-progress li.pending')
  await expect(pendingSteps).toHaveCount(2)
  for (let index = 0; index < await pendingSteps.count(); index += 1) {
    const style = await pendingSteps.nth(index).evaluate((step) => {
      const label = step.querySelector('span:not(.sr-only)')
      return {
        opacity: Number.parseFloat(getComputedStyle(step).opacity),
        fontSize: label ? Number.parseFloat(getComputedStyle(label).fontSize) : 0,
      }
    })
    expect(style.opacity, `pending step ${index + 1} opacity`).toBe(1)
    expect(style.fontSize, `pending step ${index + 1} label size`).toBeGreaterThanOrEqual(11)
  }

  await demo.click()

  const performanceBar = page.getByRole('complementary', {
    name: 'Quick performance controls',
  })
  await expect(performanceBar).toBeVisible()
  await expect(performanceBar).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  const fullMixer = page.locator('.full-mixer-disclosure')
  const fullMixerSummary = page.locator('summary[aria-controls="mixer-decks"]')
  await expect(fullMixer).not.toHaveAttribute('open', '')
  await expect(fullMixerSummary).toHaveAttribute('aria-expanded', 'false')
  await expect(fullMixerSummary).toContainText('Tracks, levels, filters, and track tools')
  await expect(page.getByRole('slider', {
    name: 'Master crossfader',
    exact: true,
  })).toHaveCount(0)

  const deckA = performanceBar.getByRole('button', { name: /Play Deck A/ })
  const deckB = performanceBar.getByRole('button', { name: /Play Deck B/ })
  await expect(deckA).toHaveAccessibleName(/Play Deck A, Neon Pulse, 120\.0 BPM/)
  await expect(deckB).toHaveAccessibleName(/Play Deck B, Midnight Circuit, 126\.0 BPM/)
  for (const deck of [deckA, deckB]) {
    expect(await deck.evaluate((button) => button.scrollWidth <= button.clientWidth)).toBe(true)
  }

  await page.getByRole('button', { name: 'Play without camera' }).click()
  await expect.poll(() => page.locator('audio').evaluateAll((audio) =>
    audio.length === 2 && audio.every((track) => !(track as HTMLAudioElement).paused),
  )).toBe(true)
  await expect(page.locator('.camera-stage')).toHaveAttribute('data-camera-status', 'idle')

  const dockButtons = performanceBar.getByRole('button')
  for (let index = 0; index < await dockButtons.count(); index += 1) {
    const box = await dockButtons.nth(index).boundingBox()
    expect(box, `dock button ${index + 1} should have a layout box`).not.toBeNull()
    expect(box!.height, `dock button ${index + 1} touch height`).toBeGreaterThanOrEqual(44)
  }

  const sync = performanceBar.getByRole('button', { name: 'Toggle BPM Sync' })
  await expect(page.getByRole('button', { name: 'Toggle BPM Sync' })).toHaveCount(1)
  await sync.click()
  await expect(sync).toHaveAttribute('aria-pressed', 'true')
  await sync.click()
  await expect(sync).toHaveAttribute('aria-pressed', 'false')

  const crossfader = performanceBar.getByRole('slider', { name: 'Quick master crossfader' })
  await fullMixerSummary.scrollIntoViewIfNeeded()
  await fullMixerSummary.focus()
  await expect(fullMixerSummary).toBeFocused()
  await fullMixerSummary.press('Enter')
  await expect(fullMixer).toHaveAttribute('open', '')
  await expect(fullMixerSummary).toHaveAttribute('aria-expanded', 'true')
  const mainCrossfader = page.getByRole('slider', { name: 'Master crossfader', exact: true })
  await expect(mainCrossfader).toBeVisible()
  const crossfaderBox = await crossfader.boundingBox()
  expect(crossfaderBox).not.toBeNull()
  await page.mouse.click(
    crossfaderBox!.x + crossfaderBox!.width * 0.8,
    crossfaderBox!.y + crossfaderBox!.height / 2,
  )
  await expect.poll(async () => {
    const [quickValue, mainValue] = await Promise.all([
      crossfader.inputValue(),
      mainCrossfader.inputValue(),
    ])
    return quickValue === mainValue && Number(quickValue) > 30
  }).toBe(true)
  await performanceBar.getByRole('button', { name: 'Center' }).click()
  await expect(crossfader).toHaveValue('0')
  await expect(mainCrossfader).toHaveValue('0')

  await page.locator('.deck-b').scrollIntoViewIfNeeded()
  await expect(performanceBar).toBeInViewport()
  const dockBox = await performanceBar.boundingBox()
  expect(dockBox).not.toBeNull()
  expect(dockBox!.x).toBeGreaterThanOrEqual(0)
  expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(390)
  expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(844)
  await expectNoHorizontalOverflow(page)

  await fullMixerSummary.scrollIntoViewIfNeeded()
  await fullMixerSummary.focus()
  await fullMixerSummary.press('Enter')
  await expect(fullMixer).not.toHaveAttribute('open', '')
  await expect(fullMixerSummary).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('slider', {
    name: 'Master crossfader',
    exact: true,
  })).toHaveCount(0)
})

test('performance controls reflow at 320 CSS pixels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Load instant demo' })).toBeInViewport()
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Load instant demo' }).click()
  const performanceBar = page.getByRole('complementary', {
    name: 'Quick performance controls',
  })
  await expect(performanceBar).toBeInViewport()
  const box = await performanceBar.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  await expectNoHorizontalOverflow(page)
})

test('desktop first-mix progress labels remain fully visible', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')

  const progressLabels = page.locator('.first-mix-progress li > span:not(.sr-only)')
  await expect(progressLabels).toHaveCount(3)
  for (let index = 0; index < await progressLabels.count(); index += 1) {
    const label = progressLabels.nth(index)
    expect(
      await label.evaluate((element) => element.scrollWidth <= element.clientWidth),
      `progress label ${index + 1} should not be visually truncated`,
    ).toBe(true)
  }
})
