import { CircleAlert } from 'lucide-react';
import { formatDuration, formatMiles, formatTime } from './time';
import { averageRiskTone, riskNames } from './risk';
import type { RiskLevel, Route, Trip } from './types';
import { MetricTooltip } from './MetricTooltip';

const riskMileage = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
function formatRiskMiles(value: number) {
  return value > 0 && value < 0.1 ? '<0.1' : riskMileage.format(value);
}

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
  const { severe_miles, high_miles, average_risk } = route.summary;
  const hasRiskStats = severe_miles > 0 || high_miles > 0 || average_risk !== 0;
  return (
    <article className={`route-row ${selected ? 'selected' : ''}`}>
      <button
        type="button"
        className="route-select"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Select ${route.label}${recommended ? ', recommended' : ''}${route.summary.status === 'blocked' ? ', No Travel' : route.summary.status === 'incomplete' ? ', incomplete weather' : ''}`}
        aria-describedby={`${route.id}-duration ${route.id}-distance ${route.id}-arrival${hasRiskStats ? ` ${route.id}-risk` : ''}`}
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
      </button>
      {hasRiskStats ? (
        <div className="risk-mileage" id={`${route.id}-risk`}>
          {severe_miles > 0 ? (
            <MetricTooltip
              level="severe"
              description="Estimated miles with severe weather along this route."
            >
              Severe <strong>{formatRiskMiles(severe_miles)}</strong> mi
            </MetricTooltip>
          ) : null}
          {high_miles > 0 ? (
            <MetricTooltip
              level="high"
              description="Estimated miles with high-risk weather along this route."
            >
              High <strong>{formatRiskMiles(high_miles)}</strong> mi
            </MetricTooltip>
          ) : null}
          {average_risk !== 0 ? (
            <MetricTooltip
              level={averageRiskTone(average_risk)}
              description="Distance-weighted average risk, from 0 (low) to 4 (no travel). Color shows the average, not the worst conditions."
            >
              Avg risk{' '}
              <strong>
                {average_risk === null
                  ? 'Unknown'
                  : average_risk > 0 && average_risk < 0.01
                    ? '<0.01'
                    : average_risk.toFixed(2)}
              </strong>
            </MetricTooltip>
          ) : null}
        </div>
      ) : null}
      {route.summary.status === 'blocked' ? (
        <div className="route-warning">
          <MetricTooltip
            warning
            level="no_travel"
            description="Unsafe miles on this route. This route cannot be recommended."
          >
            <CircleAlert size={14} aria-hidden="true" />
            No travel
            {route.summary.risk_miles.no_travel > 0
              ? ` · ${formatRiskMiles(route.summary.risk_miles.no_travel)} mi`
              : ''}
          </MetricTooltip>
        </div>
      ) : null}
      {route.summary.status === 'incomplete' ? (
        <div className="route-warning unknown">
          <MetricTooltip
            warning
            level="unknown"
            description="Weather is missing for these miles. This route cannot be recommended yet."
          >
            <CircleAlert size={14} aria-hidden="true" />
            Incomplete weather
            {route.summary.risk_miles.unknown > 0
              ? ` · ${formatRiskMiles(route.summary.risk_miles.unknown)} mi unknown`
              : ''}
          </MetricTooltip>
        </div>
      ) : null}
    </article>
  );
}
