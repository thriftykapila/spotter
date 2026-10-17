import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, MapPin, Navigation, Search } from 'lucide-react';
import { geocode } from './api';
import { localDepartureToUTC, nextDeparture, type OffsetChoice } from './time';
import type { Location, PlanInput } from './types';

export const SAMPLE_ORIGIN: Location = {
  label: 'Denver, CO',
  lat: 39.7392,
  lon: -104.9903,
  timezone: 'America/Denver',
};
export const SAMPLE_DESTINATION: Location = {
  label: 'Kansas City, MO',
  lat: 39.0997,
  lon: -94.5786,
  timezone: 'America/Chicago',
};
export type FormValues = {
  origin: Location | null;
  destination: Location | null;
  departure: string;
  load: string;
  spacing: 10 | 25 | 50;
  offsetChoice: OffsetChoice;
};
type FormField = 'origin' | 'destination' | 'departure' | 'load';
class FormValidationError extends Error {
  constructor(
    public field: FormField,
    message: string,
  ) {
    super(message);
  }
}
export function initialForm(): FormValues {
  return {
    origin: SAMPLE_ORIGIN,
    destination: SAMPLE_DESTINATION,
    departure: nextDeparture(SAMPLE_ORIGIN.timezone),
    load: '32000',
    spacing: 25,
    offsetChoice: 'reject',
  };
}
export function formToInput(values: FormValues, mode: PlanInput['mode']): PlanInput {
  if (!values.origin)
    throw new FormValidationError('origin', 'Choose an origin from the location suggestions.');
  if (!values.destination)
    throw new FormValidationError(
      'destination',
      'Choose a destination from the location suggestions.',
    );
  if (values.load.trim() === '' || !Number.isFinite(Number(values.load)) || Number(values.load) < 0)
    throw new FormValidationError('load', 'Enter a load weight of zero or more pounds.');
  if (!values.departure)
    throw new FormValidationError('departure', 'Enter a departure date and time.');
  let departure: string;
  try {
    departure = localDepartureToUTC(values.departure, values.origin.timezone, values.offsetChoice);
  } catch {
    throw new FormValidationError(
      'departure',
      'This departure time is invalid or occurs twice during a clock change. Choose another time, or select the earlier/later offset below.',
    );
  }
  return {
    mode,
    origin: values.origin,
    destination: values.destination,
    departure_at: departure,
    load_lb: Number(values.load),
    spacing_miles: values.spacing,
  };
}

function LocationField({
  label,
  selected,
  onSelected,
  readOnly,
  name,
  error,
}: {
  label: string;
  selected: Location | null;
  onSelected: (location: Location | null) => void;
  readOnly: boolean;
  name: 'origin' | 'destination';
  error?: string;
}) {
  const id = useId();
  const [text, setText] = useState(selected?.label ?? '');
  const [query, setQuery] = useState(text);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (selected) setText(selected.label);
  }, [selected]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(text);
      setActive(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);
  const result = useQuery({
    queryKey: ['geocode', query],
    queryFn: ({ signal }) => geocode(query, signal),
    enabled: !readOnly && open && query.trim().length >= 3 && query !== selected?.label,
  });
  const options = result.data?.results ?? [];
  const pick = (location: Location) => {
    onSelected(location);
    setText(location.label);
    setOpen(false);
  };
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') setOpen(false);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive((current) =>
        Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))),
      );
    }
    if (event.key === 'Enter' && open && options[active]) {
      event.preventDefault();
      pick(options[active]);
    }
  }
  const showOptions = !readOnly && open && text !== selected?.label && query.length >= 3;
  return (
    <div className="location-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-with-icon">
        <MapPin size={17} aria-hidden="true" />
        <input
          id={id}
          name={name}
          value={text}
          readOnly={readOnly}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showOptions && options.length > 0}
          aria-controls={`${id}-options`}
          aria-activedescendant={showOptions && options[active] ? `${id}-${active}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setText(event.target.value);
            onSelected(null);
            setOpen(true);
          }}
          placeholder="City, address, or ZIP code"
        />
      </div>
      {error ? (
        <p className="notice error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      {showOptions ? (
        <div
          className="suggestions"
          id={`${id}-options`}
          role="listbox"
          aria-label={`${label} suggestions`}
        >
          {result.isFetching ? <p role="status">Searching locations…</p> : null}
          {result.isError ? <p role="alert">{result.error.message}</p> : null}
          {!result.isFetching && !result.isError && options.length === 0 ? (
            <p>No locations found. Try a city and state.</p>
          ) : null}
          {options.map((location, index) => (
            <button
              key={`${location.lat},${location.lon}`}
              id={`${id}-${index}`}
              type="button"
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              className={index === active ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(location)}
            >
              <Search size={15} aria-hidden="true" />
              <span>
                {location.label}
                <small>{location.timezone}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TripForm({
  mode,
  values,
  onValues,
  onSubmit,
  pending,
  liveAvailable,
}: {
  mode: PlanInput['mode'];
  values: FormValues;
  onValues: (values: FormValues) => void;
  onSubmit: (input: PlanInput) => void;
  pending: boolean;
  liveAvailable: boolean;
}) {
  const [error, setError] = useState<{ field: FormField; message: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    onValues({ ...values, [key]: value });
    setError((current) =>
      current?.field === key || (current?.field === 'departure' && key === 'offsetChoice')
        ? null
        : current,
    );
  };
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const input = formToInput(values, mode);
      setError(null);
      onSubmit(input);
    } catch (cause) {
      const validation =
        cause instanceof FormValidationError
          ? cause
          : new FormValidationError('departure', 'Check the departure date and time.');
      setError({ field: validation.field, message: validation.message });
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLInputElement>(`[name="${validation.field}"]`)?.focus(),
      );
    }
  }
  return (
    <form ref={formRef} onSubmit={submit} className="trip-form" aria-label="Plan your trip">
      <div className="section-heading">
        <h1>Plan your trip</h1>
        <Navigation size={19} aria-hidden="true" />
      </div>
      <p className="section-intro">Find the clearest way ahead.</p>
      <LocationField
        label="Origin"
        name="origin"
        error={error?.field === 'origin' ? error.message : undefined}
        selected={values.origin}
        onSelected={(value) => update('origin', value)}
        readOnly={mode === 'sample'}
      />
      <LocationField
        label="Destination"
        name="destination"
        error={error?.field === 'destination' ? error.message : undefined}
        selected={values.destination}
        onSelected={(value) => update('destination', value)}
        readOnly={mode === 'sample'}
      />
      {mode === 'sample' ? (
        <p className="field-hint">Sample corridor: Denver → Kansas City.</p>
      ) : (
        <p className="field-hint">US routes. Select a location suggestion.</p>
      )}
      <div className="field">
        <label htmlFor="departure">Departure date & time</label>
        <input
          id="departure"
          name="departure"
          autoComplete="off"
          type="datetime-local"
          aria-invalid={error?.field === 'departure' || undefined}
          aria-describedby={`departure-hint${error?.field === 'departure' ? ' departure-error' : ''}`}
          value={values.departure}
          onChange={(event) => update('departure', event.target.value)}
          required
        />
        <p className="field-hint" id="departure-hint">
          Origin time zone: <strong>{values.origin?.timezone ?? 'Select an origin'}</strong>
        </p>
        {error?.field === 'departure' ? (
          <p className="notice error" id="departure-error">
            {error.message}
          </p>
        ) : null}
      </div>
      <details className="clock-options">
        <summary>Clock change options</summary>
        <label htmlFor="offset">When a local time occurs twice</label>
        <select
          id="offset"
          name="offset"
          value={values.offsetChoice}
          onChange={(event) => update('offsetChoice', event.target.value as OffsetChoice)}
        >
          <option value="reject">Ask me to choose</option>
          <option value="earlier">Use the earlier time</option>
          <option value="later">Use the later time</option>
        </select>
        <p className="field-hint">Times skipped when clocks move forward are always rejected.</p>
      </details>
      <div className="field">
        <label htmlFor="load">
          Load weight <span className="label-unit">lb</span>
        </label>
        <input
          id="load"
          name="load"
          autoComplete="off"
          aria-invalid={error?.field === 'load' || undefined}
          aria-describedby={`load-hint${error?.field === 'load' ? ' load-error' : ''}`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={values.load}
          onChange={(event) => update('load', event.target.value)}
          required
        />
        <p className="field-hint" id="load-hint">
          Cargo weight used for the provided wind rules.
        </p>
        {error?.field === 'load' ? (
          <p className="notice error" id="load-error">
            {error.message}
          </p>
        ) : null}
      </div>
      <fieldset className="spacing-field">
        <legend>Weather checkpoint spacing</legend>
        <div className="segmented spacing">
          {([10, 25, 50] as const).map((spacing) => (
            <label key={spacing} className={values.spacing === spacing ? 'selected' : ''}>
              <input
                type="radio"
                name="spacing"
                value={spacing}
                checked={values.spacing === spacing}
                onChange={() => update('spacing', spacing)}
              />
              <span>{spacing} miles</span>
            </label>
          ))}
        </div>
        <p className="field-hint">Smaller intervals give a more detailed assessment.</p>
      </fieldset>
      <button
        className="primary"
        type="submit"
        disabled={pending || (mode === 'live' && !liveAvailable)}
      >
        {pending ? 'Comparing routes…' : 'Compare routes'}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
