import { expect, test } from '@playwright/test'

test('synthetic open palm reaches the simplified controls without a pickup jump', async ({ page }) => {
  test.setTimeout(360_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Allow camera' }).click()

  await expect(page.getByRole('heading', { name: 'Load your tracks' })).toBeVisible({
    timeout: 180_000,
  })
  await page.getByRole('button', { name: 'Try demo tracks' }).click()
  await page.getByRole('button', { name: 'Start performance' }).click()
  await expect(page.getByText('Live on device', { exact: true })).toBeVisible()

  const volume = page.getByRole('button', { name: /^Deck A volume\./ })
  const filter = page.getByRole('button', { name: /^Deck A filter\./ })
  await expect(volume).toHaveAttribute('aria-pressed', 'true')
  await expect(volume).toHaveAccessibleName('Deck A volume. 82%')

  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(filter).toHaveAccessibleName('Deck A filter. Neutral')

  // The already-open hand must not pull the filter away from neutral. The user
  // must release and re-clutch before the continuous gesture can take over.
  await page.waitForTimeout(1_500)
  await expect(filter).toHaveAccessibleName('Deck A filter. Neutral')

  await page.getByLabel('More performance actions').click()
  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect(page.locator('.camera-stage')).toHaveAttribute('data-camera-status', 'idle')
  await expect(filter).toHaveAccessibleName('Deck A filter. Neutral')
  await expect(page.getByRole('button', { name: /Cue Deck A/ })).toBeEnabled()
  await expect(page.getByRole('button', { name: /Play Deck A/ })).toBeEnabled()
})
