import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForecastTimeline } from './ForecastTimeline';
import { RouteRow } from './RouteList';
import { CheckpointTable } from './CheckpointTable';
import { forecastColorExpression, riskColors } from './risk';
import type { Corridor, Route } from './types';

afterEach(cleanup);
const route: Route = {
  id: 'r1', label: 'I-70 route', distance_meters: 160934.4, duration_seconds: 7200,
  geometry: { type: 'LineString', coordinates: [[-105, 39], [-104, 39]] }, segments: { type: 'FeatureCollection', features: [] },
  checkpoints: [{ id: 'cp1', lat: 39, lon: -105, distance_meters: 0, elapsed_seconds: 0, eta: '2026-10-18T14:00:00Z', weather: null, risk: { level: 'unknown', score: null, reasons: ['Weather unavailable'] } }],
  summary: { status: 'blocked', arrival_at: '2026-10-18T16:00:00Z', risk_miles: { low: 0, moderate: 0, high: 10, severe: 20, no_travel: 70, unknown: 0 }, average_risk: 3.3, severe_miles: 20, high_miles: 10 },
};
describe('route safety states', () => {
  it('makes no travel visible and selectable for inspection', () => {
    const select = vi.fn(); render(<RouteRow route={route} index={0} recommended={false} selected={false} onSelect={select} timezone="America/Chicago" />);
    expect(screen.getByText('No travel: 70.0 miles')).toBeInTheDocument();
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button')); expect(select).toHaveBeenCalledOnce();
  });
  it('distinguishes incomplete weather from safe weather', () => {
    render(<RouteRow route={{ ...route, summary: { ...route.summary, status: 'incomplete', average_risk: null } }} index={0} recommended={false} selected={true} onSelect={vi.fn()} timezone="America/Chicago" />);
    expect(screen.getByText('Incomplete weather: recommendation unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
  it('offers an accessible checkpoint action with unknown risk', () => {
    const select = vi.fn(); render(<CheckpointTable route={route} timezone="America/Denver" selectedId={null} onSelect={select} />);
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Locate checkpoint 1, 0 mi' })); expect(select).toHaveBeenCalledWith(route.checkpoints[0]);
  });
});
describe('forecast timeline', () => {
  const corridor: Corridor = { trip_id: 'trip', departure_at: '2026-10-18T14:00:00Z', hours: Array.from({ length: 49 }, (_, index) => new Date(Date.UTC(2026, 9, 18, 14 + index)).toISOString()), cell_size_miles: 25, cells: { type: 'FeatureCollection', features: [] }, warnings: [] };
  it('moves to any of the 49 frames through a local callback', () => {
    const hour = vi.fn(); const visible = vi.fn(); render(<ForecastTimeline corridor={corridor} hour={0} onHour={hour} visible={true} onVisible={visible} timezone="America/Denver" loading={false} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '48' } }); expect(hour).toHaveBeenCalledWith(48);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show heatmap' })); expect(visible).toHaveBeenCalledWith(false);
  });
  it('disables the slider until corridor data is ready', () => {
    render(<ForecastTimeline hour={0} onHour={vi.fn()} visible={true} onVisible={vi.fn()} timezone="America/Denver" loading={true} />);
    expect(screen.getByRole('slider')).toBeDisabled(); expect(screen.getByText('Loading 48-hour forecast…')).toBeInTheDocument();
  });
  it('uses a fixed palette and clamps forecast frames', () => {
    expect(forecastColorExpression(48)).toEqual(['match', ['coalesce', ['at', 48, ['get', 'risks']], -1], 0, riskColors.low, 1, riskColors.moderate, 2, riskColors.high, 3, riskColors.severe, 4, riskColors.no_travel, riskColors.unknown]);
    expect(JSON.stringify(forecastColorExpression(100))).toContain('["at",48');
  });
});
