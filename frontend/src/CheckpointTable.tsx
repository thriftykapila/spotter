import { ChevronDown, MapPin } from 'lucide-react';
import { formatMiles, formatTime } from './time';
import { RiskBadge } from './RouteList';
import type { Checkpoint, Route } from './types';

export function CheckpointTable({
  route,
  timezone,
  selectedId,
  onSelect,
}: {
  route: Route;
  timezone: string;
  selectedId: string | null;
  onSelect: (checkpoint: Checkpoint) => void;
}) {
  return (
    <details className="checkpoints">
      <summary>
        <div>
          <strong>Checkpoints</strong>
          <span>
            {route.checkpoints.length} · {route.label}
          </span>
        </div>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="checkpoint-scroll" role="region" aria-label="Checkpoint weather" tabIndex={0}>
        <table>
          <caption className="sr-only">
            Arrival-time weather and risk for {route.label}. Select a checkpoint to locate it on the
            map.
          </caption>
          <thead>
            <tr>
              <th scope="col">Checkpoint</th>
              <th scope="col">ETA</th>
              <th scope="col">Wind / gust (mph)</th>
              <th scope="col">Rain (in/hr)</th>
              <th scope="col">Snow (in/hr)</th>
              <th scope="col">Risk</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {route.checkpoints.map((checkpoint, index) => (
              <tr key={checkpoint.id} className={selectedId === checkpoint.id ? 'active' : ''}>
                <th scope="row">
                  <button
                    type="button"
                    onClick={() => onSelect(checkpoint)}
                    aria-label={`Locate checkpoint ${index + 1}, ${formatMiles(checkpoint.distance_meters)}`}
                    aria-pressed={selectedId === checkpoint.id}
                  >
                    <MapPin size={14} aria-hidden="true" />
                    <span>
                      {index + 1}
                      <small>{formatMiles(checkpoint.distance_meters)}</small>
                    </span>
                  </button>
                </th>
                <td>
                  <time dateTime={checkpoint.eta}>{formatTime(checkpoint.eta, timezone)}</time>
                </td>
                <td>
                  {checkpoint.weather
                    ? `${checkpoint.weather.wind_mph.toFixed(1)} / ${checkpoint.weather.gust_mph?.toFixed(1) ?? '—'}`
                    : 'Unknown'}
                </td>
                <td>{checkpoint.weather ? checkpoint.weather.rain_in_hr.toFixed(2) : '—'}</td>
                <td>{checkpoint.weather ? checkpoint.weather.snow_in_hr.toFixed(2) : '—'}</td>
                <td>
                  <RiskBadge level={checkpoint.risk.level} />
                </td>
                <td>
                  <details className="checkpoint-reason">
                    <summary aria-label={`Risk explanation for checkpoint ${index + 1}`}>
                      Details
                    </summary>
                    <p>
                      {checkpoint.risk.reasons.join('; ') || 'Within the supplied risk thresholds.'}
                    </p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
