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
  await expect(page.getByRole('heading', { name: 'Routes' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(3);
  await expect(page.getByRole('form', { name: 'Plan your trip' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Data source' })).toHaveCount(0);
  const slider = page.getByRole('slider', { name: 'Forecast hour after departure' });
  await expect(slider).toBeEnabled();
  const recommended = page.getByRole('button', { name: /Select .+, recommended/ });
  await expect(recommended).toHaveAttribute('aria-pressed', 'true');
  const before = requests.length;
  await slider.fill('48');
  await expect(page.getByText('+48 hr', { exact: true })).toBeVisible();
  await expect(recommended).toHaveAttribute('aria-pressed', 'true');
  expect(requests.length).toBe(before);
  await page.getByRole('checkbox', { name: 'Heatmap' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Heatmap' })).not.toBeChecked();
  await page
    .getByRole('button', { name: /^Select / })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /^Select / }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByText('Checkpoints', { exact: true }).click();
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

test('editing the example submits live routing with the selected load and spacing', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { live_available: true, missing_configuration: [] } }),
  );
  const initialPlan = page.waitForResponse((response) =>
    response.url().endsWith('/api/trips/plan'),
  );
  const initialCorridor = page.waitForResponse(
    (response) => response.url().includes('/api/trips/') && response.url().endsWith('/corridor'),
  );
  await page.goto('/');
  const example = await (await initialPlan).json();
  const forecast = await (await initialCorridor).json();
  await expect(page.getByRole('slider')).toBeEnabled();
  let liveInput: Record<string, unknown> | undefined;
  await page.route('**/api/trips/plan', async (route) => {
    liveInput = route.request().postDataJSON();
    await route.fulfill({
      json: {
        ...example,
        id: 'mock-live-trip',
        mode: 'live',
        load_lb: 45000,
        spacing_miles: 10,
        warnings: [],
      },
    });
  });
  await page.route('**/api/trips/mock-live-trip/corridor', (route) =>
    route.fulfill({ json: { ...forecast, trip_id: 'mock-live-trip', warnings: [] } }),
  );
  await page.getByLabel('Load weight', { exact: false }).fill('45000');
  await page.getByRole('combobox', { name: 'Checkpoint spacing' }).selectOption('10');
  await page.getByRole('button', { name: 'Find routes', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(3);
  expect(liveInput).toMatchObject({ mode: 'live', load_lb: 45000, spacing_miles: 10 });
  await expect(page.getByRole('form', { name: 'Plan your trip' })).toBeVisible();
  await expect(page.getByRole('slider')).toHaveValue('0');
});

test('clear removes the example and keeps the trip controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('slider')).toBeEnabled();
  await page.getByLabel('Load weight', { exact: false }).fill('41000');
  await page.getByRole('combobox', { name: 'Checkpoint spacing' }).selectOption('50');
  await page.getByRole('button', { name: 'Clear trip', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Origin', exact: true })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Destination', exact: true })).toHaveValue('');
  await expect(page.getByLabel('Load weight', { exact: false })).toHaveValue('41000');
  await expect(page.getByRole('combobox', { name: 'Checkpoint spacing' })).toHaveValue('50');
  await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(0);
  await expect(page.getByText('Checkpoints', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('slider')).toBeDisabled();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
});

test('unavailable live routing stays explicit without a source picker', async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { live_available: false, missing_configuration: ['TOMTOM_API_KEY'] } }),
  );
  await page.goto('/');
  await expect(page.getByText('Live routes unavailable.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find routes', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Recheck service', exact: true })).toBeEnabled();
  await expect(page.getByRole('group', { name: 'Data source' })).toHaveCount(0);
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
  await page.getByText('Checkpoints', { exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: /^Locate checkpoint 1,/ }).click();
  await expect(page.locator('.checkpoint-scroll tr.active')).toHaveCount(1);
});
