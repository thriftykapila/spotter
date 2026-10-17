import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { getCorridor, getHealth, planTrip } from './api';
import { TripForm, formToInput, initialForm, SAMPLE_ORIGIN, type FormValues } from './TripForm';
import { RouteList } from './RouteList';
import { ForecastTimeline } from './ForecastTimeline';
import { CheckpointTable } from './CheckpointTable';
import { formatTime } from './time';
import type { Checkpoint, PlanInput, Trip } from './types';

const TripMap = lazy(() => import('./TripMap'));
export default function App() {
  const [values, setValues] = useState<FormValues>(initialForm);
  const [initialInput] = useState(() => formToInput(values, 'sample'));
  const [trip, setTrip] = useState<Trip>();
  const [formResetKey, setFormResetKey] = useState(0);
  const requestEpoch = useRef(0);
  const initialized = useRef(false);
  const [selectedId, setSelectedId] = useState('');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint | null>(null);
  const [hour, setHour] = useState(0);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const plan = useMutation({
    mutationFn: ({ input }: { input: PlanInput; epoch: number }) => planTrip(input),
    onSuccess: (result, { epoch }) => {
      // Clear and newer submissions invalidate every older response, including the initial example.
      if (epoch !== requestEpoch.current) return;
      setTrip(result);
      setSelectedId(result.recommended_route_id ?? result.routes[0]?.id ?? '');
      setSelectedCheckpoint(null);
      setHour(0);
    },
  });
  const { mutate } = plan;
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    mutate({ input: initialInput, epoch: 0 });
  }, [initialInput, mutate]);
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
    (corridor.isError ||
      hasUnknownForecast ||
      (trip?.mode === 'live' && (corridor.data?.warnings.length ?? 0) > 0));
  const criticalWarnings =
    trip?.warnings.filter((warning) =>
      /no.?travel|incomplete|unavailable|unknown|could not|insufficient/i.test(warning),
    ) ?? [];
  const pending = plan.isPending;
  function submit(input: PlanInput) {
    const epoch = ++requestEpoch.current;
    plan.mutate({ input, epoch });
  }
  function loadExample() {
    const next = initialForm();
    setValues(next);
    setFormResetKey((key) => key + 1);
    submit(formToInput(next, 'sample'));
  }
  function clearTrip() {
    requestEpoch.current += 1;
    plan.reset();
    setTrip(undefined);
    setValues((current) => ({ ...current, origin: null, destination: null }));
    setFormResetKey((key) => key + 1);
    setSelectedId('');
    setSelectedCheckpoint(null);
    setHour(0);
  }
  const selectRoute = (id: string) => {
    setSelectedId(id);
    setSelectedCheckpoint(null);
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#trip-controls">
        Skip to trip controls
      </a>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Spotter home">
          <strong>spotter</strong>
        </a>
      </header>
      <main className="workspace">
        <aside className="sidebar" id="trip-controls">
          <TripForm
            values={values}
            onValues={setValues}
            onSubmit={submit}
            pending={pending}
            liveAvailable={health.data?.live_available ?? false}
            onClear={clearTrip}
            resetKey={formResetKey}
          />
          {!health.isPending && !health.data?.live_available ? (
            <div className="service-notice notice" role="status">
              <span>Live routes unavailable.</span>
              <button
                className="text-button"
                disabled={health.isFetching}
                onClick={() => void health.refetch()}
              >
                {health.isFetching ? 'Checking service…' : 'Recheck service'}
              </button>
            </div>
          ) : null}
          {plan.isError ? (
            <div className="notice error request-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{plan.error.message}</span>
              <button
                className="text-button"
                onClick={() =>
                  plan.variables?.input.mode === 'sample' ? loadExample() : plan.reset()
                }
              >
                {plan.variables?.input.mode === 'sample' ? 'Retry example' : 'Dismiss error'}
              </button>
            </div>
          ) : null}
          {criticalWarnings.length ? (
            <p className="trip-warnings" role="status">
              {criticalWarnings.join(' ')}
            </p>
          ) : null}
          {trip ? (
            <RouteList trip={trip} selectedId={selectedRouteId} onSelect={selectRoute} />
          ) : (
            <div className="empty-routes" role="status">
              {pending ? 'Finding routes…' : 'Enter a trip to find routes.'}
            </div>
          )}
          <details className="trip-notes">
            <summary>Trip notes</summary>
            {trip?.mode === 'sample' ? (
              <p>Example routes and weather are synthetic. Find routes requests live data.</p>
            ) : null}
            <p>
              Arrival-time forecasts are sampled along each route. Driving ETAs exclude stops and
              rest breaks. Check current road conditions before travel.
            </p>
            {trip?.warnings.map((warning, index) => (
              <p key={`trip-${index}`}>{warning}</p>
            ))}
            {trip &&
              corridor.data?.warnings.map((warning, index) => (
                <p key={`forecast-${index}`}>{warning}</p>
              ))}
            {health.isError ? <p>The service could not be reached.</p> : null}
            {trip ? (
              <p>
                {trip.mode === 'sample' ? 'Example generated' : 'Weather fetched'}{' '}
                {formatTime(trip.weather_fetched_at, trip.origin.timezone)} · Expires{' '}
                {formatTime(trip.expires_at, trip.origin.timezone)}
              </p>
            ) : null}
          </details>
        </aside>
        <section className="main-panel" aria-label="Trip results">
          <div className={`map-workspace ${pending ? 'updating' : ''}`} aria-busy={pending}>
            <Suspense
              fallback={
                <div className="map-loading" role="status">
                  Loading map…
                </div>
              }
            >
              <TripMap
                trip={trip}
                selectedId={selectedRouteId}
                selectedCheckpoint={selectedCheckpoint}
                corridor={trip ? corridor.data : undefined}
                hour={hour}
                showHeatmap={showHeatmap}
                onRouteSelect={selectRoute}
                onCheckpointSelect={setSelectedCheckpoint}
              />
            </Suspense>
            {pending ? (
              <div className="map-progress" role="status">
                Updating route…
              </div>
            ) : null}
            <ForecastTimeline
              corridor={trip ? corridor.data : undefined}
              hour={hour}
              onHour={setHour}
              visible={showHeatmap}
              onVisible={setShowHeatmap}
              timezone={trip?.origin.timezone ?? SAMPLE_ORIGIN.timezone}
              loading={Boolean(trip) && corridor.isFetching}
              error={trip ? corridor.error?.message : undefined}
            />
            {canRetryForecast ? (
              <div className="forecast-actions">
                {corridor.isError || hasUnknownForecast ? (
                  <span role="status">
                    {hasUnknownForecast ? 'Partial forecast' : 'Forecast unavailable'}
                  </span>
                ) : null}
                <button
                  className="text-button"
                  disabled={corridor.isFetching}
                  onClick={() => void corridor.refetch()}
                >
                  {corridor.isFetching ? 'Retrying forecast…' : 'Retry forecast'}
                </button>
              </div>
            ) : null}
          </div>
          {selectedRoute && trip ? (
            <CheckpointTable
              route={selectedRoute}
              timezone={trip.origin.timezone}
              selectedId={selectedCheckpoint?.id ?? null}
              onSelect={setSelectedCheckpoint}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
