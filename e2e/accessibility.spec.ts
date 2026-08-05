import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const WCAG_A_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa']

async function expectNoWcagViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_A_AA_TAGS).analyze()
  const summary = results.violations
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)
    .join('\n')
  expect(results.violations, `${state} has WCAG A/AA violations${summary ? `:\n${summary}` : ''}`).toEqual([])
}

async function openTracks(page: Page) {
  await page.getByRole('button', { name: 'Use mouse controls instead' }).click()
}

async function loadGeneratedDemo(page: Page) {
  await openTracks(page)
  await page.getByRole('button', { name: 'Try generated demo tracks' }).click()
  await expect(page.getByText('Neon Pulse', { exact: true })).toBeVisible()
}

async function openPerformance(page: Page) {
  await page.getByRole('button', { name: 'Open performance · 2 tracks' }).click()
  await expect(page.locator('.uv-performance-stage')).toBeVisible()
}

test('camera-first setup meets WCAG A/AA and exposes its keyboard path', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Put the music under your hands.' })).toBeVisible()
  await expectNoWcagViolations(page, 'Camera-first setup')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Ultra Vision home' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Allow private camera' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Use mouse controls instead' })).toBeFocused()
})

test('track loading and live performance meet WCAG A/AA', async ({ page }) => {
  await page.goto('/')
  await loadGeneratedDemo(page)
  await expectNoWcagViolations(page, 'Track loading')
  await openPerformance(page)
  await expectNoWcagViolations(page, 'Live performance')
  await page.getByRole('button', { name: 'Manual controls' }).click()
  await expect(page.getByRole('region', { name: 'Manual mixer controls' })).toBeVisible()
  await expectNoWcagViolations(page, 'Manual controls')
})

test('390px camera error keeps recovery readable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: () => Promise.reject(new DOMException('Denied by test', 'NotAllowedError')),
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Allow private camera' }).click()
  const message = page.getByText(
    'Camera permission was blocked. Allow access in your browser, then try again.',
    { exact: true },
  ).first()
  await expect(message).toBeVisible({ timeout: 180_000 })
  await expect(page.locator('.uv-camera-preview')).toHaveAttribute('data-camera-status', 'error')
  expect(await message.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expectNoWcagViolations(page, '390px camera permission error')
})

test('390px loaded performance has no horizontal overflow and meets WCAG A/AA', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await loadGeneratedDemo(page)
  await openPerformance(page)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoWcagViolations(page, '390px performance')
})
