import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, MapPin, Search } from 'lucide-react';
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
  name,
  error,
}: {
  label: string;
  selected: Location | null;
  onSelected: (location: Location | null) => void;
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
    enabled: open && query.trim().length >= 3 && query !== selected?.label,
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
  const showOptions = open && text !== selected?.label && query.length >= 3;
  return (
    <div className="location-field">
      <label htmlFor={id}>{label}</label>
      <div className="input-with-icon">
        <MapPin size={17} aria-hidden="true" />
        <input
          id={id}
          name={name}
          value={text}
          required
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
              key={`${location.label}|${location.timezone}|${location.lat},${location.lon}`}
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
  values,
  onValues,
  onSubmit,
  pending,
  liveAvailable,
  onClear,
  resetKey = 0,
}: {
  values: FormValues;
  onValues: (values: FormValues) => void;
  onSubmit: (input: PlanInput) => void;
  pending: boolean;
  liveAvailable: boolean;
  onClear: () => void;
  resetKey?: number;
}) {
  const [error, setError] = useState<{ field: FormField; message: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => setError(null), [resetKey]);
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
      const input = formToInput(values, 'live');
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
      <div className="trip-panel-header">
        <h1>Trip planner</h1>
        <button type="button" className="clear-trip text-button" onClick={onClear}>
          Clear trip
        </button>
      </div>
      <div className="location-fields">
        <LocationField
          key={`origin-${resetKey}`}
          label="Origin"
          name="origin"
          error={error?.field === 'origin' ? error.message : undefined}
          selected={values.origin}
          onSelected={(value) => update('origin', value)}
        />
        <LocationField
          key={`destination-${resetKey}`}
          label="Destination"
          name="destination"
          error={error?.field === 'destination' ? error.message : undefined}
          selected={values.destination}
          onSelected={(value) => update('destination', value)}
        />
      </div>
      <div className="field">
        <div className="field-label-row">
          <label htmlFor="departure">Departure date & time</label>
          <span className="field-label-meta" id="departure-hint">
            <span className="sr-only">Origin time zone:</span>{' '}
            {values.origin?.timezone ?? 'Select origin'}
          </span>
        </div>
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
        {error?.field === 'departure' ? (
          <p className="notice error" id="departure-error">
            {error.message}
          </p>
        ) : null}
      </div>
      {error?.field === 'departure' || values.offsetChoice !== 'reject' ? (
        <details className="clock-options" open>
          <summary>Options</summary>
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
      ) : null}
      <div className="form-row">
        <div className="field">
          <label htmlFor="load">
            Load weight <span className="label-unit">lb</span>
          </label>
          <input
            id="load"
            name="load"
            autoComplete="off"
            aria-invalid={error?.field === 'load' || undefined}
            aria-describedby={error?.field === 'load' ? 'load-error' : undefined}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={values.load}
            onChange={(event) => update('load', event.target.value)}
            required
          />
          {error?.field === 'load' ? (
            <p className="notice error" id="load-error">
              {error.message}
            </p>
          ) : null}
        </div>
        <div className="field spacing-field">
          <label htmlFor="spacing">Checkpoint spacing</label>
          <div className="select-with-icon">
            <select
              id="spacing"
              name="spacing"
              value={values.spacing}
              onChange={(event) =>
                update('spacing', Number(event.target.value) as FormValues['spacing'])
              }
            >
              {([10, 25, 50] as const).map((spacing) => (
                <option key={spacing} value={spacing}>
                  {spacing} miles
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>
        </div>
      </div>
      <button className="primary" type="submit" disabled={pending || !liveAvailable}>
        {pending ? 'Finding routes…' : 'Find routes'}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  );
}
