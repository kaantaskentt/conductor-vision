import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const WCAG_A_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
]

type DemoPerformanceWindow = Window & {
  __ultraVisionDemoLongTasks?: number[]
  __ultraVisionDemoObserver?: PerformanceObserver
}

async function expectNoWcagViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_A_AA_TAGS)
    .analyze()

  const summary = results.violations
    .map((violation) => {
      const targets = violation.nodes
        .map((node) => node.target.join(' '))
        .join(', ')
      return `${violation.id} (${violation.impact ?? 'impact unknown'}): ${targets}`
    })
    .join('\n')

  expect(
    results.violations,
    `${state} has WCAG A/AA violations${summary ? `:\n${summary}` : ''}`,
  ).toEqual([])
}

async function loadGeneratedDemo(page: Page) {
  await page.getByRole('button', { name: 'Load instant demo' }).click()
  await expect(page.getByRole('complementary', {
    name: 'Quick performance controls',
  })).toBeVisible()
}

test('camera-off DJ Room meets WCAG A/AA and exposes its keyboard path', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mix with your hands.' })).toBeVisible()
  await expectNoWcagViolations(page, 'Camera-off DJ Room')

  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Ultra Vision home' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Vision' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'DJ Room' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Load instant demo' })).toBeFocused()
})

test('loaded-demo DJ Room stays responsive and meets WCAG A/AA', async ({ page }) => {
  await page.goto('/')
  const supportsLongTasks = await page.evaluate(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return false
    const performanceWindow = window as DemoPerformanceWindow
    performanceWindow.__ultraVisionDemoLongTasks = []
    performanceWindow.__ultraVisionDemoObserver = new PerformanceObserver((list) => {
      performanceWindow.__ultraVisionDemoLongTasks?.push(
        ...list.getEntries().map((entry) => entry.duration),
      )
    })
    performanceWindow.__ultraVisionDemoObserver.observe({ type: 'longtask' })
    return true
  })
  expect(supportsLongTasks).toBe(true)

  await loadGeneratedDemo(page)
  const longTasks = await page.evaluate(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const performanceWindow = window as DemoPerformanceWindow
    performanceWindow.__ultraVisionDemoObserver?.disconnect()
    return performanceWindow.__ultraVisionDemoLongTasks ?? []
  })
  expect(longTasks, `Demo loading created long tasks: ${longTasks.join(', ')} ms`).toEqual([])
  await expectNoWcagViolations(page, 'Loaded-demo DJ Room')
})

test('camera-off Vision workspace meets WCAG A/AA', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Vision' }).click()
  await expect(page.getByRole('heading', {
    name: 'See what the camera understands.',
  })).toBeVisible()
  await expectNoWcagViolations(page, 'Camera-off Vision workspace')
})

test('390px Vision permission error keeps its recovery visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const auditWindow = window as Window & { __ultraVisionCameraAttempts?: number }
    auditWindow.__ultraVisionCameraAttempts = 0
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: () => {
        auditWindow.__ultraVisionCameraAttempts =
          (auditWindow.__ultraVisionCameraAttempts ?? 0) + 1
        return Promise.reject(new DOMException('Denied by test', 'NotAllowedError'))
      },
    })
  })
  await page.goto('/')
  await loadGeneratedDemo(page)
  await page.getByRole('button', { name: 'Vision' }).click()
  await page.getByRole('button', { name: 'Start camera' }).click()

  const recoveryMessage = page.getByText(
    'Camera permission was blocked. Allow access in your browser, then try again.',
    { exact: true },
  ).first()
  await expect(page.locator('.camera-stage')).toHaveAttribute('data-camera-status', 'error')
  await expect(recoveryMessage).toBeVisible()
  const retry = page.getByRole('button', { name: 'Retry camera' })
  await expect(retry).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __ultraVisionCameraAttempts?: number })
      .__ultraVisionCameraAttempts ?? 0,
  )).toBe(1)

  await retry.click()
  await expect.poll(() => page.evaluate(() =>
    (window as Window & { __ultraVisionCameraAttempts?: number })
      .__ultraVisionCameraAttempts ?? 0,
  )).toBe(2)
  await expect(page.locator('.camera-stage')).toHaveAttribute('data-camera-status', 'error')
  await expect(recoveryMessage).toBeVisible()
  await expectNoWcagViolations(page, '390px Vision permission error')
  await page.getByRole('button', { name: 'DJ Room' }).click()
  const djRecoveryMessage = page.locator('.dj-vision-layout .camera-empty p')
  await expect(djRecoveryMessage).toHaveText(
    'Camera permission was blocked. Allow access in your browser, then try again.',
  )
  await expect(djRecoveryMessage).toBeVisible()
  const djRecoveryFit = await djRecoveryMessage.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      horizontalFit: element.scrollWidth <= element.clientWidth,
      verticalFit: element.scrollHeight <= element.clientHeight,
      whiteSpace: style.whiteSpace,
      overflow: style.overflow,
      overflowWrap: style.overflowWrap,
    }
  })
  expect(djRecoveryFit, JSON.stringify(djRecoveryFit)).toMatchObject({
    horizontalFit: true,
    verticalFit: true,
  })
  await expectNoWcagViolations(page, '390px DJ Room permission error')
})

test('390px loaded-demo DJ Room meets WCAG A/AA', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await loadGeneratedDemo(page)
  await expectNoWcagViolations(page, '390px loaded-demo DJ Room')
})
