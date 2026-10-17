import { Check, ChevronRight, CircleAlert, Clock3 } from 'lucide-react';
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
  const recommendedTitle = trip.routes
    .find((route) => route.id === trip.recommended_route_id)
    ?.label.split(' · ')[0];
  return (
    <section className="route-list" aria-labelledby="route-heading">
      <div className="section-heading">
        <h2 id="route-heading">Route comparison</h2>
        <span className="count">{trip.routes.length} routes</span>
      </div>
      {trip.recommended_route_id === null ? (
        <p className="no-recommendation">No eligible route available.</p>
      ) : null}
      <details className="recommendation">
        <summary>
          {recommendedTitle
            ? `Why ${recommendedTitle} is recommended`
            : 'Why no route is recommended'}
        </summary>
        <p>{trip.recommendation_reason}</p>
      </details>
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
      <p className="method-note">
        Ranked by severe miles, high miles, average risk, then travel time. No travel routes are
        excluded.
      </p>
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
      className={`route-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Select ${route.label}${recommended ? ', recommended' : ''}`}
    >
      <div className="route-row-top">
        <span className="route-name">
          <span className="route-number">{index + 1}</span>
          {title}
        </span>
        {recommended ? (
          <span className="recommended-tag">
            <Check size={13} aria-hidden="true" />
            Recommended
          </span>
        ) : (
          <ChevronRight size={17} aria-hidden="true" />
        )}
      </div>
      {roadParts.length ? <p className="route-roads">{roadParts.join(' · ')}</p> : null}
      <div className="route-time">
        <strong>{formatDuration(route.duration_seconds)}</strong>
        <span>{formatMiles(route.distance_meters)}</span>
      </div>
      <p className="route-arrival">
        <Clock3 size={14} aria-hidden="true" />
        Arrive {formatTime(route.summary.arrival_at, timezone)}
      </p>
      <div className="risk-mileage">
        <span>
          <strong>{route.summary.severe_miles.toFixed(1)}</strong> severe mi
        </span>
        <span>
          <strong>{route.summary.high_miles.toFixed(1)}</strong> high mi
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
          Incomplete weather: recommendation unavailable
        </p>
      ) : null}
    </button>
  );
}
