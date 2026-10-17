import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForecastTimeline } from './ForecastTimeline';
import { RouteRow } from './RouteList';
import { CheckpointTable } from './CheckpointTable';
import { forecastColorExpression, riskColors } from './risk';
import type { Corridor, Route } from './types';
import { TripForm, initialForm } from './TripForm';

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());
describe('accessible trip validation', () => {
  it('associates an ambiguous clock-change error with departure and focuses the field without submitting', async () => {
    const submit = vi.fn();
    const values = { ...initialForm(), departure: '2026-11-01T01:30' };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TripForm
          values={values}
          onValues={vi.fn()}
          onSubmit={submit}
          pending={false}
          liveAvailable={true}
          onClear={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText('When a local time occurs twice')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: 'Plan your trip' }));
    const departure = screen.getByLabelText('Departure date & time');
    await waitFor(() => expect(departure).toHaveFocus());
    expect(departure).toHaveAttribute('aria-invalid', 'true');
    expect(departure).toHaveAccessibleDescription(
      /Origin time zone: America\/Denver.*occurs twice during a clock change/,
    );
    expect(document.getElementById('departure-error')).toHaveTextContent('earlier/later offset');
    expect(screen.getByRole('combobox', { name: 'When a local time occurs twice' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Use the earlier time' })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
const route: Route = {
  id: 'r1',
  label: 'I-70 route',
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
  checkpoints: [
    {
      id: 'cp1',
      lat: 39,
      lon: -105,
      distance_meters: 0,
      elapsed_seconds: 0,
      eta: '2026-10-18T14:00:00Z',
      weather: null,
      risk: { level: 'unknown', score: null, reasons: ['Weather unavailable'] },
    },
  ],
  summary: {
    status: 'blocked',
    arrival_at: '2026-10-18T16:00:00Z',
    risk_miles: { low: 0, moderate: 0, high: 10, severe: 20, no_travel: 70, unknown: 0 },
    average_risk: 3.3,
    severe_miles: 20,
    high_miles: 10,
  },
};
describe('route safety states', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(20, 100, 120, 24),
    );
  });
  it('makes no travel visible and selectable for inspection', () => {
    const select = vi.fn();
    render(
      <RouteRow
        route={route}
        index={0}
        recommended={false}
        selected={false}
        onSelect={select}
        timezone="America/Chicago"
      />,
    );
    expect(screen.getByText('No travel · 70 mi')).toBeInTheDocument();
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Select / }));
    expect(select).toHaveBeenCalledOnce();
  });
  it('distinguishes incomplete weather from safe weather', () => {
    render(
      <RouteRow
        route={{
          ...route,
          summary: { ...route.summary, status: 'incomplete', average_risk: null },
        }}
        index={0}
        recommended={false}
        selected={true}
        onSelect={vi.fn()}
        timezone="America/Chicago"
      />,
    );
    expect(screen.getByRole('button', { name: 'Incomplete weather' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Avg risk Unknown' }).parentElement).toHaveClass(
      'risk-unknown',
    );
    expect(screen.getByRole('button', { name: /^Select / })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('explains route metrics on hover, focus, and tap without changing route selection', async () => {
    const select = vi.fn();
    render(
      <RouteRow
        route={route}
        index={0}
        recommended={false}
        selected={false}
        onSelect={select}
        timezone="America/Chicago"
      />,
    );
    const stat = screen.getByRole('button', { name: 'Severe 20 mi' });
    fireEvent.mouseEnter(stat);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Estimated miles with severe weather');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.mouseEnter(stat);
    fireEvent.mouseLeave(stat);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    fireEvent.focus(stat);
    expect(stat).toHaveAccessibleDescription(
      'Estimated miles with severe weather along this route.',
    );
    fireEvent.keyDown(stat, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(stat);
    expect(screen.getByRole('tooltip')).toBeVisible();
    expect(select).not.toHaveBeenCalled();
    fireEvent.blur(stat);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Select / }));
    expect(select).toHaveBeenCalledOnce();
  });
  it('hides zero summaries without an empty strip or missing accessible description', () => {
    const { container } = render(
      <RouteRow
        route={{
          ...route,
          summary: {
            ...route.summary,
            status: 'eligible',
            severe_miles: 0,
            high_miles: 0,
            average_risk: 0,
          },
        }}
        index={0}
        recommended={true}
        selected={true}
        onSelect={vi.fn()}
        timezone="America/Chicago"
      />,
    );
    expect(
      screen.queryByRole('button', { name: /^Severe|^High|^Avg risk/ }),
    ).not.toBeInTheDocument();
    expect(container.querySelector('.risk-mileage')).toBeNull();
    expect(
      screen.getByRole('button', { name: /^Select / }).getAttribute('aria-describedby'),
    ).not.toContain('r1-risk');
    expect(screen.getByText('Recommended')).toBeVisible();
  });
  it('retains tiny positive exposure and a dominant blocked state beside a low average', () => {
    render(
      <RouteRow
        route={{
          ...route,
          summary: { ...route.summary, severe_miles: 0, high_miles: 0.001, average_risk: 0.004 },
        }}
        index={0}
        recommended={false}
        selected={true}
        onSelect={vi.fn()}
        timezone="America/Chicago"
      />,
    );
    expect(screen.queryByRole('button', { name: /^Severe/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'High <0.1 mi' }).parentElement).toHaveClass(
      'risk-high',
    );
    expect(screen.getByRole('button', { name: 'Avg risk <0.01' }).parentElement).toHaveClass(
      'risk-low',
    );
    expect(screen.getByRole('button', { name: 'No travel · 70 mi' }).parentElement).toHaveClass(
      'risk-no_travel',
    );
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
  });
  it('keeps the blocked warning even when its mileage is zero', () => {
    render(
      <RouteRow
        route={{
          ...route,
          summary: { ...route.summary, risk_miles: { ...route.summary.risk_miles, no_travel: 0 } },
        }}
        index={0}
        recommended={false}
        selected={false}
        onSelect={vi.fn()}
        timezone="America/Chicago"
      />,
    );
    expect(screen.getByRole('button', { name: 'No travel' })).toBeVisible();
  });
  it('keeps tooltip text hoverable outside the scrolling route card', async () => {
    render(
      <RouteRow
        route={route}
        index={0}
        recommended={false}
        selected={false}
        onSelect={vi.fn()}
        timezone="America/Chicago"
      />,
    );
    const stat = screen.getByRole('button', { name: 'High 10 mi' });
    fireEvent.mouseEnter(stat);
    const description = screen.getByRole('tooltip');
    expect(description.parentElement).toBe(document.body);
    fireEvent.mouseLeave(stat);
    fireEvent.mouseEnter(description);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(description).toBeVisible();
    fireEvent.mouseLeave(description);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });
  it('offers an accessible checkpoint action with unknown risk', () => {
    const select = vi.fn();
    render(
      <CheckpointTable
        route={route}
        timezone="America/Denver"
        selectedId={null}
        onSelect={select}
      />,
    );
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Locate checkpoint 1, 0 mi' }));
    expect(select).toHaveBeenCalledWith(route.checkpoints[0]);
  });
});
describe('forecast timeline', () => {
  const corridor: Corridor = {
    trip_id: 'trip',
    departure_at: '2026-10-18T14:00:00Z',
    hours: Array.from({ length: 49 }, (_, index) =>
      new Date(Date.UTC(2026, 9, 18, 14 + index)).toISOString(),
    ),
    cell_size_miles: 25,
    cells: { type: 'FeatureCollection', features: [] },
    warnings: [],
  };
  it('moves to any of the 49 frames through a local callback', () => {
    const hour = vi.fn();
    const visible = vi.fn();
    render(
      <ForecastTimeline
        corridor={corridor}
        hour={0}
        onHour={hour}
        visible={true}
        onVisible={visible}
        timezone="America/Denver"
        loading={false}
      />,
    );
    fireEvent.change(screen.getByRole('slider'), { target: { value: '48' } });
    expect(hour).toHaveBeenCalledWith(48);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Heatmap' }));
    expect(visible).toHaveBeenCalledWith(false);
  });
  it('disables the slider until corridor data is ready', () => {
    render(
      <ForecastTimeline
        hour={0}
        onHour={vi.fn()}
        visible={true}
        onVisible={vi.fn()}
        timezone="America/Denver"
        loading={true}
      />,
    );
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByText('Loading forecast…')).toBeInTheDocument();
  });
  it('uses a fixed palette and clamps forecast frames', () => {
    expect(forecastColorExpression(48)).toEqual([
      'match',
      ['coalesce', ['at', 48, ['get', 'risks']], -1],
      0,
      riskColors.low,
      1,
      riskColors.moderate,
      2,
      riskColors.high,
      3,
      riskColors.severe,
      4,
      riskColors.no_travel,
      riskColors.unknown,
    ]);
    expect(JSON.stringify(forecastColorExpression(100))).toContain('["at",48');
  });
});
