import { expect, test } from '@playwright/test'

test('synthetic open palm reaches the focused mixer without a value jump', async ({ page }) => {
  test.setTimeout(360_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Allow private camera' }).click()
  await expect(page.getByRole('button', { name: 'Camera ready · continue' })).toBeVisible({ timeout: 180_000 })
  await page.getByRole('button', { name: 'Camera ready · continue' }).click()
  await page.getByRole('button', { name: 'Try generated demo tracks' }).click()
  await expect(page.getByText('Neon Pulse', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open performance · 2 tracks' }).click()

  await expect(page.getByText('Open hand live', { exact: true })).toBeVisible()
  await expect(page.locator('[data-air-target="filter:a"]')).toContainText('Neutral')
  await page.locator('[data-air-target="filter:a"]').click()
  await expect(page.locator('.uv-control-readout')).toContainText('Filter')
  await expect(page.locator('[data-air-target="filter:a"]')).toContainText('Neutral')

  await page.getByRole('button', { name: 'Stop camera' }).click()
  await expect(page.getByText('Manual mode', { exact: true }).first()).toBeVisible()
  await expect(page.locator('[data-air-target="filter:a"]')).toContainText('Neutral')
})
