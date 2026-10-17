import { ChevronDown, MapPin } from 'lucide-react';
import { formatMiles, formatTime } from './time';
import { RiskBadge } from './RouteList';
import type { Checkpoint, Route } from './types';

export function CheckpointTable({ route, timezone, selectedId, onSelect }: { route: Route; timezone: string; selectedId: string | null; onSelect: (checkpoint: Checkpoint) => void }) {
  return <details className="checkpoints">
    <summary><div><strong>Weather checkpoints</strong><span>{route.label} · {route.checkpoints.length} checkpoints</span></div><ChevronDown size={18} aria-hidden="true" /></summary>
    <div className="checkpoint-scroll"><table><caption className="sr-only">Arrival-time weather and risk for {route.label}. Select a checkpoint to locate it on the map.</caption><thead><tr><th scope="col">Checkpoint</th><th scope="col">ETA</th><th scope="col">Wind / gust</th><th scope="col">Rain</th><th scope="col">Snow</th><th scope="col">Risk</th><th scope="col">Reason</th></tr></thead><tbody>{route.checkpoints.map((checkpoint, index) => <tr key={checkpoint.id} className={selectedId === checkpoint.id ? 'active' : ''}><th scope="row"><button onClick={() => onSelect(checkpoint)} aria-label={`Locate checkpoint ${index + 1}, ${formatMiles(checkpoint.distance_meters)}`}><MapPin size={14} aria-hidden="true" /><span>{index + 1}<small>{formatMiles(checkpoint.distance_meters)}</small></span></button></th><td>{formatTime(checkpoint.eta, timezone)}</td><td>{checkpoint.weather ? `${checkpoint.weather.wind_mph.toFixed(1)} / ${checkpoint.weather.gust_mph?.toFixed(1) ?? '—'} mph` : 'Unknown'}</td><td>{checkpoint.weather ? `${checkpoint.weather.rain_in_hr.toFixed(2)} in/hr` : '—'}</td><td>{checkpoint.weather ? `${checkpoint.weather.snow_in_hr.toFixed(2)} in/hr` : '—'}</td><td><RiskBadge level={checkpoint.risk.level} /></td><td>{checkpoint.risk.reasons.join('; ') || 'Below all risk thresholds.'}</td></tr>)}</tbody></table></div>
  </details>;
}
