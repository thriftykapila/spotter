import { lazy, Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert, CloudSun, Route as RouteIcon } from 'lucide-react';
import { getCorridor, getHealth, planTrip } from './api';
import {
  TripForm,
  initialForm,
  SAMPLE_DESTINATION,
  SAMPLE_ORIGIN,
  type FormValues,
} from './TripForm';
import { RouteList } from './RouteList';
import { ForecastTimeline } from './ForecastTimeline';
import { CheckpointTable } from './CheckpointTable';
import { formatTime } from './time';
import { formToInput } from './TripForm';
import type { Checkpoint, PlanInput } from './types';

const TripMap = lazy(() => import('./TripMap'));
export default function App() {
  const [mode, setMode] = useState<PlanInput['mode']>('sample');
  const [values, setValues] = useState<FormValues>(initialForm);
  const [initialInput] = useState(() => formToInput(values, 'sample'));
  const [selectedId, setSelectedId] = useState('');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint | null>(null);
  const [hour, setHour] = useState(0);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [editing, setEditing] = useState(false);
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, staleTime: 30_000 });
  const initial = useQuery({
    queryKey: ['initial-sample'],
    queryFn: () => planTrip(initialInput),
    staleTime: Infinity,
  });
  const plan = useMutation({
    mutationFn: planTrip,
    onSuccess: (result) => {
      setSelectedId(result.recommended_route_id ?? result.routes[0]?.id ?? '');
      setSelectedCheckpoint(null);
      setHour(0);
      setEditing(false);
    },
  });
  const trip = plan.data ?? initial.data;
  const selectedRouteId = trip?.routes.some((route) => route.id === selectedId)
    ? selectedId
    : (trip?.recommended_route_id ?? trip?.routes[0]?.id ?? '');
  const selectedRoute = trip?.routes.find((route) => route.id === selectedRouteId);
  const corridor = useQuery({
    queryKey: ['corridor', trip?.id],
    queryFn: ({ signal }) => getCorridor(trip!.id, signal),
    enabled: Boolean(trip),
    staleTime: 14 * 60_000,
  });
  const hasUnknownForecast = useMemo(
    () =>
      corridor.data?.cells.features.some((cell) =>
        cell.properties.risks.some((risk) => risk === null),
      ) ?? false,
    [corridor.data],
  );
  const canRetryForecast =
    Boolean(trip) &&
    (corridor.isError || (corridor.data?.warnings.length ?? 0) > 0 || hasUnknownForecast);
  const pending = plan.isPending || initial.isPending;
  const selectRoute = (id: string) => {
    setSelectedId(id);
    setSelectedCheckpoint(null);
  };
  function useSample() {
    setMode('sample');
    setValues((current) => ({
      ...current,
      origin: SAMPLE_ORIGIN,
      destination: SAMPLE_DESTINATION,
    }));
  }
  function sampleTrip() {
    const next = initialForm();
    setMode('sample');
    setValues(next);
    plan.mutate(formToInput(next, 'sample'));
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#trip-controls">
        Skip to trip controls
      </a>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Spotter home">
          <span className="brand-mark">
            <RouteIcon size={22} aria-hidden="true" />
          </span>
          <strong>spotter</strong>
          <span className="brand-description">Weather-aware routing</span>
        </a>
        <div className="header-actions">
          <span className={`service-status ${health.data?.live_available ? 'available' : ''}`}>
            <span aria-hidden="true" />
            {health.isPending
              ? 'Checking service'
              : health.isError
                ? 'Service unavailable'
                : health.data?.live_available
                  ? 'Live service ready'
                  : 'Sample mode ready'}
          </span>
          <button className="secondary" onClick={sampleTrip} disabled={pending}>
            Load sample trip
          </button>
        </div>
      </header>
      <main className="workspace">
        <aside className="sidebar" id="trip-controls">
          <div className="mode-section">
            <div className="segmented mode-selector" role="group" aria-label="Data source">
              <button
                className={mode === 'sample' ? 'selected' : ''}
                aria-pressed={mode === 'sample'}
                onClick={useSample}
              >
                Sample trip
              </button>
              <button
                className={mode === 'live' ? 'selected' : ''}
                aria-pressed={mode === 'live'}
                onClick={() => {
                  setMode('live');
                  setEditing(true);
                }}
              >
                Live routes
              </button>
            </div>
            {mode === 'sample' ? (
              <p className="mode-description">
                <CloudSun size={16} aria-hidden="true" />
                <span>
                  <strong>Synthetic demo</strong> — sample routes and weather. Change the load or
                  departure to explore the rules.
                </span>
              </p>
            ) : !health.data?.live_available ? (
              <div className="notice" role="status">
                <strong>Live routing is not configured.</strong>
                <p>
                  {health.isError
                    ? 'The backend service could not be reached.'
                    : health.data?.missing_configuration.length
                      ? `Missing configuration: ${health.data.missing_configuration.join(', ')}.`
                      : 'Routing credentials and shared storage are required.'}{' '}
                  The sample trip works without credentials.
                </p>
              </div>
            ) : (
              <p className="mode-description">
                Live routing and weather from third-party forecasts.
              </p>
            )}
          </div>
          {!trip || editing ? (
            <div>
              <TripForm
                mode={mode}
                values={values}
                onValues={setValues}
                onSubmit={(input) => plan.mutate(input)}
                pending={pending}
                liveAvailable={health.data?.live_available ?? false}
              />
              {trip ? (
                <button className="close-editor text-button" onClick={() => setEditing(false)}>
                  Back to route comparison
                </button>
              ) : null}
            </div>
          ) : (
            <section className="trip-summary" aria-label="Trip details">
              <div className="section-heading">
                <h1>Trip details</h1>
                <button className="edit-trip" onClick={() => setEditing(true)}>
                  Edit trip
                </button>
              </div>
              <p
                className="trip-summary-places"
                title={`${trip.origin.label} to ${trip.destination.label}`}
              >
                {trip.origin.label.split(',')[0]} <span aria-hidden="true">→</span>{' '}
                {trip.destination.label.split(',')[0]}
              </p>
              <dl>
                <div>
                  <dt>Departs</dt>
                  <dd>{formatTime(trip.departure_at, trip.origin.timezone)}</dd>
                </div>
                <div className="summary-pair">
                  <div>
                    <dt>Load</dt>
                    <dd>{trip.load_lb.toLocaleString()} lb</dd>
                  </div>
                  <div>
                    <dt>Checkpoints</dt>
                    <dd>{trip.spacing_miles} miles</dd>
                  </div>
                </div>
              </dl>
            </section>
          )}
          {plan.isError || initial.isError ? (
            <div className="notice error request-error" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <div>
                {(plan.error ?? initial.error)?.message}
                <button
                  className="text-button"
                  onClick={() => (plan.isError ? plan.reset() : initial.refetch())}
                >
                  {plan.isError ? 'Dismiss error' : 'Retry sample trip'}
                </button>
              </div>
            </div>
          ) : null}
          {trip ? (
            <RouteList trip={trip} selectedId={selectedRouteId} onSelect={selectRoute} />
          ) : (
            <div className="empty-routes" role="status">
              {pending ? 'Comparing three sample routes…' : 'Plan a trip to compare routes.'}
            </div>
          )}
          <div className="sidebar-footnote">
            Planning aid. Forecasts and checkpoint samples cannot guarantee road conditions.
          </div>
        </aside>
        <section className="main-panel" aria-label="Trip results">
          <div className="results-bar">
            <div>
              <h2>{trip ? 'Your route, with the weather ahead' : 'Weather along the way'}</h2>
              <p>
                {trip
                  ? `${trip.load_lb.toLocaleString()} lb load · Checkpoints every ${trip.spacing_miles} miles · Depart ${formatTime(trip.departure_at, trip.origin.timezone)}`
                  : 'Compare arrival-time weather across route options.'}
              </p>
            </div>
            {trip ? (
              <span className={`data-badge ${trip.mode}`}>
                {trip.mode === 'sample' ? 'Synthetic demo' : 'Live forecast'}
              </span>
            ) : null}
          </div>
          {trip?.warnings.length ? (
            <div className="trip-warnings" role="status">
              <CircleAlert size={15} aria-hidden="true" />
              <span>{trip.warnings.join(' ')}</span>
            </div>
          ) : null}
          <div className={`map-workspace ${pending ? 'updating' : ''}`} aria-busy={pending}>
            <Suspense
              fallback={
                <div className="map-loading" role="status">
                  Loading interactive map…
                </div>
              }
            >
              <TripMap
                trip={trip}
                selectedId={selectedRouteId}
                selectedCheckpoint={selectedCheckpoint}
                corridor={corridor.data}
                hour={hour}
                showHeatmap={showHeatmap}
                onRouteSelect={selectRoute}
                onCheckpointSelect={setSelectedCheckpoint}
              />
            </Suspense>
            {pending ? (
              <div className="map-progress" role="status">
                Comparing route weather…
              </div>
            ) : null}
            <ForecastTimeline
              corridor={corridor.data}
              hour={hour}
              onHour={setHour}
              visible={showHeatmap}
              onVisible={setShowHeatmap}
              timezone={trip?.origin.timezone ?? SAMPLE_ORIGIN.timezone}
              loading={corridor.isFetching}
              error={corridor.error?.message}
            />
          </div>
          {corridor.data?.warnings.length ? (
            <p className="corridor-warning" role="status">
              {corridor.data.warnings.join(' ')}
            </p>
          ) : null}
          {canRetryForecast ? (
            <div className="corridor-warning" role="status">
              <p>
                {hasUnknownForecast ? 'Some corridor forecast values are unknown. ' : ''}
                Retry the forecast without changing the route assessment or recommendation.
              </p>
              <button
                className="secondary"
                disabled={corridor.isFetching}
                onClick={() => void corridor.refetch()}
              >
                {corridor.isFetching ? 'Retrying forecast…' : 'Retry forecast'}
              </button>
            </div>
          ) : null}
          {selectedRoute && trip ? (
            <CheckpointTable
              route={selectedRoute}
              timezone={trip.origin.timezone}
              selectedId={selectedCheckpoint?.id ?? null}
              onSelect={setSelectedCheckpoint}
            />
          ) : null}
          {trip ? (
            <footer className="results-footnote">
              {trip.mode === 'sample' ? 'Synthetic weather generated' : 'Weather fetched'}{' '}
              {formatTime(trip.weather_fetched_at, trip.origin.timezone)} · Assessment expires{' '}
              {formatTime(trip.expires_at, trip.origin.timezone)}
            </footer>
          ) : null}
        </section>
      </main>
    </div>
  );
}
