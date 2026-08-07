import { expect, test } from '@playwright/test'

test('synthetic open palm reaches the mixer without a pickup jump', async ({ page }) => {
  test.setTimeout(360_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Load instant demo' }).click()

  const crossfader = page.getByRole('slider', { name: 'Quick master crossfader' })
  await expect(crossfader).toHaveValue('0')

  await page.getByRole('button', { name: 'Start performance' }).click()
  await expect(page.getByText('Live on device', { exact: true })).toBeVisible({
    timeout: 180_000,
  })
  await expect(page.locator('.gesture-state-pill')).toHaveText('Armed')
  await expect(page.locator('.first-mix-cockpit')).toHaveClass(/stage-ready/)
  await expect(page.getByText('Crossfader armed · move left or right', { exact: true }))
    .toBeVisible()
  await expect(crossfader).toHaveValue('0')

  await page.getByText('Choose Air Control', { exact: true }).click()
  await page.getByRole('button', { name: /^Filter\./ }).click()
  await expect(page.locator('.gesture-state-pill')).toHaveText('Release hand')
  await expect(page.getByRole('heading', { name: 'Close your hand once' })).toBeVisible()
  await expect(crossfader).toHaveValue('0')

  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect(page.locator('.camera-stage')).toHaveAttribute('data-camera-status', 'idle')
  await expect(page.locator('.gesture-state-pill')).toHaveText('Locked')
  await expect(crossfader).toHaveValue('0')
})
