import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getCorridor, getHealth, planTrip } from './api';
import type { Corridor, Route, Trip } from './types';

vi.mock('./api', () => ({
  getHealth: vi.fn(),
  planTrip: vi.fn(),
  getCorridor: vi.fn(),
  geocode: vi.fn(),
}));
vi.mock('./TripMap', () => ({ default: () => <div data-testid="map-placeholder" /> }));

const route: Route = {
  id: 'route-a',
  label: 'Route A · I-70',
  distance_meters: 160934.4,
  duration_seconds: 7200,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-105, 39],
      [-104, 39],
    ],
  },
  segments: { type: 'FeatureCollection', features: [] },
  checkpoints: [],
  summary: {
    status: 'eligible',
    arrival_at: '2026-10-18T16:00:00Z',
    risk_miles: { low: 100, moderate: 0, high: 0, severe: 0, no_travel: 0, unknown: 0 },
    average_risk: 0,
    severe_miles: 0,
    high_miles: 0,
  },
};
const trip: Trip = {
  id: 'sample_trip',
  mode: 'sample',
  origin: { label: 'Denver, CO', lat: 39.7392, lon: -104.9903, timezone: 'America/Denver' },
  destination: {
    label: 'Kansas City, MO',
    lat: 39.0997,
    lon: -94.5786,
    timezone: 'America/Chicago',
  },
  departure_at: '2026-10-18T14:00:00Z',
  load_lb: 32000,
  spacing_miles: 25,
  routes: [route, { ...route, id: 'route-b', label: 'Route B · I-80' }],
  recommended_route_id: 'route-b',
  recommendation_reason: 'Route B has the lowest weather risk.',
  warnings: [],
  weather_fetched_at: '2026-10-18T13:50:00Z',
  expires_at: '2026-10-18T14:05:00Z',
};
const corridor: Corridor = {
  trip_id: trip.id,
  departure_at: trip.departure_at,
  hours: Array.from({ length: 49 }, (_, index) =>
    new Date(Date.UTC(2026, 9, 18, 14 + index)).toISOString(),
  ),
  cell_size_miles: 25,
  warnings: [],
  cells: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-105, 39],
              [-104, 39],
              [-104, 40],
              [-105, 39],
            ],
          ],
        },
        properties: {
          id: 'cell-a',
          risks: Array<number | null>(49).fill(0),
          wind_mph: Array<number | null>(49).fill(10),
          rain_in_hr: Array<number | null>(49).fill(0),
          snow_in_hr: Array<number | null>(49).fill(0),
        },
      },
    ],
  },
};
function renderApp() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getHealth).mockResolvedValue({
    live_available: false,
    missing_configuration: ['TOMTOM_API_KEY'],
  });
  vi.mocked(planTrip).mockResolvedValue(trip);
  vi.mocked(getCorridor).mockResolvedValue(corridor);
});
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
});

describe('live service availability', () => {
  it('refreshes on entering Live and can recheck without losing the form or assessment', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByRole('slider')).toBeEnabled());
    expect(getHealth).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Live routes' }));
    await waitFor(() => expect(getHealth).toHaveBeenCalledTimes(2));
    const recheck = await screen.findByRole('button', { name: 'Recheck service' });
    const compare = screen.getByRole('button', { name: 'Compare routes' });
    expect(compare).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Departure date & time'), {
      target: { value: '2026-10-19T09:15' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Load weight lb' }), {
      target: { value: '43000' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '50 miles' }));
    const selected = screen.getByRole('button', { name: /^Select Route A/ });
    fireEvent.click(selected);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '24' } });

    let finishHealth!: (value: Awaited<ReturnType<typeof getHealth>>) => void;
    vi.mocked(getHealth).mockImplementationOnce(
      () => new Promise((resolve) => (finishHealth = resolve)),
    );
    fireEvent.click(recheck);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Checking service…' })).toBeDisabled(),
    );
    await act(async () => finishHealth({ live_available: true, missing_configuration: [] }));

    await screen.findByText('Live service ready');
    expect(screen.queryByRole('button', { name: 'Recheck service' })).not.toBeInTheDocument();
    expect(compare).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Origin' })).toHaveValue('Denver, CO');
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('Kansas City, MO');
    expect(screen.getByLabelText('Departure date & time')).toHaveValue('2026-10-19T09:15');
    expect(screen.getByRole('spinbutton', { name: 'Load weight lb' })).toHaveValue(43000);
    expect(screen.getByRole('radio', { name: '50 miles' })).toBeChecked();
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('slider')).toHaveValue('24');
    expect(getHealth).toHaveBeenCalledTimes(3);
    expect(planTrip).toHaveBeenCalledTimes(1);
    expect(getCorridor).toHaveBeenCalledTimes(1);
  });

  it('refreshes stale health on focus without refetching the trip or corridor', async () => {
    vi.mocked(getHealth)
      .mockResolvedValueOnce({ live_available: false, missing_configuration: ['TOMTOM_API_KEY'] })
      .mockResolvedValueOnce({ live_available: true, missing_configuration: [] });
    const { client } = renderApp();
    await waitFor(() => expect(screen.getByRole('slider')).toBeEnabled());
    await screen.findByText('Sample mode ready');
    focusManager.setFocused(false);
    await client.invalidateQueries({ queryKey: ['health'], refetchType: 'none' });
    await act(async () => focusManager.setFocused(true));
    await screen.findByText('Live service ready');
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(planTrip).toHaveBeenCalledTimes(1);
    expect(getCorridor).toHaveBeenCalledTimes(1);
  });
});

describe('corridor forecast retry', () => {
  it.each(['error', 'warnings', 'unknown'] as const)(
    'can retry a forecast with %s without replanning or changing selection',
    async (state) => {
      if (state === 'error')
        vi.mocked(getCorridor).mockRejectedValueOnce(new Error('Weather provider unavailable'));
      if (state === 'warnings')
        vi.mocked(getCorridor).mockResolvedValueOnce({
          ...corridor,
          warnings: ['Some forecast data could not be fetched.'],
        });
      if (state === 'unknown')
        vi.mocked(getCorridor).mockResolvedValueOnce({
          ...corridor,
          cells: {
            ...corridor.cells,
            features: corridor.cells.features.map((cell) => ({
              ...cell,
              properties: { ...cell.properties, risks: [null, ...cell.properties.risks.slice(1)] },
            })),
          },
        });
      renderApp();
      const retry = await screen.findByRole('button', { name: 'Retry forecast' });
      const selected = screen.getByRole('button', { name: /^Select Route A/ });
      const recommended = screen.getByRole('button', { name: /Select Route B.*recommended/ });
      fireEvent.click(selected);
      const slider = screen.getByRole('slider');
      if (state !== 'error') fireEvent.change(slider, { target: { value: '24' } });
      expect(getCorridor).toHaveBeenCalledTimes(1);
      fireEvent.click(retry);
      await waitFor(() => expect(getCorridor).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Retry forecast' })).not.toBeInTheDocument(),
      );
      expect(planTrip).toHaveBeenCalledTimes(1);
      expect(selected).toHaveAttribute('aria-pressed', 'true');
      expect(recommended).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Recommended', { exact: true })).toBeInTheDocument();
      expect(slider).toHaveValue(state === 'error' ? '0' : '24');
    },
  );
  it('does not show a retry control for a complete forecast without warnings', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByRole('slider')).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Retry forecast' })).not.toBeInTheDocument();
  });
});
describe('request error actions', () => {
  it('labels and retries the failed initial sample request', async () => {
    vi.mocked(planTrip).mockRejectedValueOnce(new Error('Routing service unavailable'));
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry sample trip' }));
    await screen.findByRole('heading', { name: 'Route comparison' });
    expect(planTrip).toHaveBeenCalledTimes(2);
  });
  it('labels a failed comparison action as dismiss and does not silently retry', async () => {
    vi.mocked(planTrip)
      .mockResolvedValueOnce(trip)
      .mockRejectedValueOnce(new Error('Comparison unavailable'));
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit trip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare routes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss error' }));
    await waitFor(() =>
      expect(screen.queryByText('Comparison unavailable')).not.toBeInTheDocument(),
    );
    expect(planTrip).toHaveBeenCalledTimes(2);
  });
});
