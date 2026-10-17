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
          <strong>Forecast</strong>
          <details className="forecast-info">
            <summary aria-label="About the forecast">
              <Info size={15} aria-hidden="true" />
            </summary>
            <p>
              Approximate corridor weather at the selected time. Route rankings use weather at each
              checkpoint’s arrival. Times shown in {timezone}.
            </p>
          </details>
        </div>
        <label className="heatmap-toggle">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => onVisible(event.target.checked)}
          />
          Heatmap
        </label>
      </div>
      <div className="forecast-time">
        <span>
          {corridor ? (
            <time dateTime={corridor.hours[hour]}>
              {formatTime(corridor.hours[hour], timezone)}
            </time>
          ) : loading ? (
            'Loading forecast…'
          ) : error ? (
            'Forecast unavailable'
          ) : (
            'Plan a trip to see weather'
          )}
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
        <span>0</span>
        <span>12</span>
        <span>24</span>
        <span>36</span>
        <span>48 hr</span>
      </div>
      {error || corridor ? (
        <p className="forecast-footnote" role={error ? 'alert' : undefined}>
          {error ?? `${corridor!.cell_size_miles.toLocaleString()} mi cells`}
        </p>
      ) : null}
    </section>
  );
}
