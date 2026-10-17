import { expect, test } from '@playwright/test';

test('sample route comparison, arrival weather, and local forecast scrubbing', async ({ page }) => {
  const requests: string[] = [];
  const renderingErrors: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) requests.push(`${request.method()} ${request.url()}`);
  });
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /Worker failed|Error:.*(layer|source|expression)/i.test(message.text())
    )
      renderingErrors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Route comparison' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(3);
  await expect(page.getByText('Synthetic demo', { exact: true })).toHaveCount(2);
  const slider = page.getByRole('slider', { name: 'Forecast hour after departure' });
  await expect(slider).toBeEnabled();
  const recommended = page.getByRole('button', { name: /Select .+, recommended/ });
  await expect(recommended).toHaveAttribute('aria-pressed', 'true');
  const before = requests.length;
  await slider.fill('48');
  await expect(page.getByText('+48 hr', { exact: true })).toHaveCount(2);
  await expect(recommended).toHaveAttribute('aria-pressed', 'true');
  expect(requests.length).toBe(before);
  await page.getByRole('checkbox', { name: 'Show heatmap' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Show heatmap' })).not.toBeChecked();
  await page
    .getByRole('button', { name: /^Select / })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /^Select / }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByText('Weather checkpoints', { exact: true }).click();
  await page.getByRole('button', { name: /^Locate checkpoint 1,/ }).click();
  await expect(page.locator('.checkpoint-scroll tr.active')).toHaveCount(1);
  await expect(page.getByTestId('route-map')).toHaveAttribute('data-map-ready', 'true');
  await expect(page.locator('.map-popup')).toContainText('ETA');
  await expect
    .poll(async () => {
      const stage = await page.locator('.map-stage').boundingBox();
      const canvas = await page.locator('.maplibregl-canvas').boundingBox();
      return Math.abs((stage?.height ?? 0) - (canvas?.height ?? -100));
    })
    .toBeLessThan(1);
  expect(renderingErrors).toEqual([]);
});

test('sample load and checkpoint spacing can be reassessed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Compare routes', exact: true })).toBeEnabled();
  await page.getByLabel('Load weight', { exact: false }).fill('45000');
  await page.getByRole('radio', { name: '10 miles' }).check();
  await page.getByRole('button', { name: 'Compare routes', exact: true }).click();
  await expect(page.getByText(/45,000 lb load · Checkpoints every 10 miles/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(3);
  await expect(page.getByRole('slider')).toHaveValue('0');
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
});

test('unconfigured live mode is explicit and never silently substitutes sample data', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { live_available: false, missing_configuration: ['TOMTOM_API_KEY'] } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Live routes', exact: true }).click();
  await expect(page.getByText('Live routing is not configured.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare routes', exact: true })).toBeDisabled();
  await expect(page.getByText(/Missing configuration: TOMTOM_API_KEY/)).toBeVisible();
});

test('route details remain usable without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
      if (String(args[0]).startsWith('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto('/');
  await expect(page.getByText('Interactive map unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(3);
  await page.getByText('Weather checkpoints', { exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: /^Locate checkpoint 1,/ }).click();
  await expect(page.locator('.checkpoint-scroll tr.active')).toHaveCount(1);
});
