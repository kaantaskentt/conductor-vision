import { expect, test } from '@playwright/test'

type FirstMixStageWindow = Window & {
  __ultraVisionFirstMixStages?: string[]
}

test('synthetic open palm reaches the mixer without a pickup jump', async ({ page }) => {
  test.fixme(
    true,
    'The current single-frame candidate reaches live MediaPipe but does not yet detect reliably.',
  )
  test.setTimeout(360_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Load instant demo' }).click()

  const crossfader = page.getByRole('slider', { name: 'Quick master crossfader' })
  await expect(crossfader).toHaveValue('0')

  await page.evaluate(() => {
    const cockpit = document.querySelector('.first-mix-cockpit')
    if (!cockpit) throw new Error('First Mix cockpit is unavailable.')
    const stageWindow = window as FirstMixStageWindow
    stageWindow.__ultraVisionFirstMixStages = [cockpit.className]
    new MutationObserver(() => {
      stageWindow.__ultraVisionFirstMixStages?.push(cockpit.className)
    }).observe(cockpit, { attributes: true, attributeFilter: ['class'] })
  })

  await page.getByRole('button', { name: 'Start performance' }).click()
  await expect(page.getByText('Live on device', { exact: true })).toBeVisible({
    timeout: 180_000,
  })
  await expect(page.getByText('Live instruction', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    (window as FirstMixStageWindow).__ultraVisionFirstMixStages?.some((stage) =>
      stage.includes('stage-calibrating'),
    ) ?? false,
  )).toBe(true)
  await expect(page.locator('.gesture-state-pill')).toHaveText('Armed')
  await expect(page.locator('.first-mix-cockpit')).toHaveClass(/stage-ready/)
  await expect(crossfader).toHaveValue('0')

  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect(page.locator('.camera-stage')).toHaveAttribute('data-camera-status', 'idle')
  await expect(page.locator('.gesture-state-pill')).toHaveText('Locked')
  await expect(crossfader).toHaveValue('0')
})
