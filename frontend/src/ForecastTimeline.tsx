import { CloudSun, Info } from 'lucide-react';
import { formatTime } from './time';
import type { Corridor } from './types';

export function ForecastTimeline({
  corridor,
  hour,
  onHour,
  visible,
  onVisible,
  timezone,
  loading,
  error,
}: {
  corridor?: Corridor;
  hour: number;
  onHour: (hour: number) => void;
  visible: boolean;
  onVisible: (visible: boolean) => void;
  timezone: string;
  loading: boolean;
  error?: string;
}) {
  return (
    <section className="forecast-timeline" aria-label="Corridor weather forecast">
      <div className="forecast-header">
        <div className="forecast-title">
          <CloudSun size={19} aria-hidden="true" />
          <strong>Corridor forecast</strong>
          <span
            className="info-tip"
            title="A weather risk grid across the trip corridor. Each hour shows weather at one forecast time. This view does not change the arrival-time route assessment."
          >
            <Info size={15} aria-hidden="true" />
          </span>
        </div>
        <label className="heatmap-toggle">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => onVisible(event.target.checked)}
          />
          Show heatmap
        </label>
      </div>
      <div className="forecast-time">
        <span>
          {corridor
            ? formatTime(corridor.hours[hour], timezone)
            : loading
              ? 'Loading 48-hour forecast…'
              : 'Forecast unavailable'}
        </span>
        <strong>+{hour} hr</strong>
      </div>
      <label className="sr-only" htmlFor="forecast-hour">
        Forecast hour after departure
      </label>
      <input
        id="forecast-hour"
        type="range"
        min="0"
        max="48"
        step="1"
        value={hour}
        onChange={(event) => onHour(Number(event.target.value))}
        disabled={!corridor}
        aria-valuetext={`${hour} hours after departure${corridor ? `, ${formatTime(corridor.hours[hour], timezone)}` : ''}`}
      />
      <div className="forecast-scale" aria-hidden="true">
        <span>Departure</span>
        <span>+12 hr</span>
        <span>+24 hr</span>
        <span>+36 hr</span>
        <span>+48 hr</span>
      </div>
      <p className="forecast-footnote">
        {error ??
          (corridor
            ? `${corridor.cell_size_miles.toFixed(1)}-mile cells · Hourly forecast · Route rankings use checkpoint arrival times`
            : 'The corridor is loaded separately from your route assessment.')}
      </p>
    </section>
  );
}
