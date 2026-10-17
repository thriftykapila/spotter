import { CircleAlert } from 'lucide-react';
import { formatDuration, formatMiles, formatTime } from './time';
import { riskNames } from './risk';
import type { RiskLevel, Route, Trip } from './types';

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`risk-badge risk-${level}`}>
      <span aria-hidden="true" className="risk-dot" />
      {riskNames[level]}
    </span>
  );
}
export function RouteList({
  trip,
  selectedId,
  onSelect,
}: {
  trip: Trip;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="route-list" aria-labelledby="route-heading">
      <div className="section-heading">
        <h2 id="route-heading">Routes</h2>
        <span className="count">{trip.routes.length}</span>
      </div>
      {trip.recommended_route_id === null ? (
        <p className="no-recommendation">No eligible route available.</p>
      ) : null}
      <div className="route-options">
        {trip.routes.map((route, index) => (
          <RouteRow
            key={route.id}
            route={route}
            index={index}
            recommended={trip.recommended_route_id === route.id}
            selected={selectedId === route.id}
            onSelect={() => onSelect(route.id)}
            timezone={trip.destination.timezone}
          />
        ))}
      </div>
      <details className="recommendation">
        <summary>
          {trip.recommended_route_id ? 'Why this route?' : 'Why no recommendation?'}
        </summary>
        <p>{trip.recommendation_reason}</p>
      </details>
    </section>
  );
}
export function RouteRow({
  route,
  index,
  recommended,
  selected,
  onSelect,
  timezone,
}: {
  route: Route;
  index: number;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
  timezone: string;
}) {
  const [title, ...roadParts] = route.label.split(' · ');
  return (
    <button
      type="button"
      className={`route-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Select ${route.label}${recommended ? ', recommended' : ''}${route.summary.status === 'blocked' ? ', No Travel' : route.summary.status === 'incomplete' ? ', incomplete weather' : ''}`}
      aria-describedby={`${route.id}-duration ${route.id}-distance ${route.id}-arrival ${route.id}-risk`}
    >
      <div className="route-row-header">
        <span className="route-name">
          <span className="route-number">{index + 1}</span>
          <span>{title}</span>
          {recommended ? <span className="recommended-tag">Recommended</span> : null}
        </span>
        <strong id={`${route.id}-duration`}>{formatDuration(route.duration_seconds)}</strong>
      </div>
      <div className="route-subtitle">
        <span className="route-roads">
          {roadParts.length ? `${roadParts.join(' · ').replace(/\s*\/\s*/g, '/')} · ` : null}
          <span id={`${route.id}-distance`}>{formatMiles(route.distance_meters)}</span>
        </span>
        <span className="route-arrival" id={`${route.id}-arrival`}>
          <span className="sr-only">Arrive </span>
          <time dateTime={route.summary.arrival_at}>
            {formatTime(route.summary.arrival_at, timezone)}
          </time>
        </span>
      </div>
      <div className="risk-mileage" id={`${route.id}-risk`}>
        <span>
          <strong>{route.summary.severe_miles.toFixed(1)}</strong> Severe mi
        </span>
        <span>
          <strong>{route.summary.high_miles.toFixed(1)}</strong> High mi
        </span>
        <span>
          Avg <strong>{route.summary.average_risk?.toFixed(2) ?? '—'}</strong> / 4
        </span>
      </div>
      {route.summary.status === 'blocked' ? (
        <p className="route-warning">
          <CircleAlert size={14} aria-hidden="true" />
          No travel: {route.summary.risk_miles.no_travel.toFixed(1)} miles
        </p>
      ) : null}
      {route.summary.status === 'incomplete' ? (
        <p className="route-warning unknown">
          <CircleAlert size={14} aria-hidden="true" />
          Incomplete weather · {route.summary.risk_miles.unknown.toFixed(1)} mi unknown
        </p>
      ) : null}
    </button>
  );
}
