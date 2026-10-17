import { describe, expect, it } from 'vitest';
import { localDepartureToUTC, formatDuration, miles } from './time';
import { formToInput, SAMPLE_DESTINATION, SAMPLE_ORIGIN, type FormValues } from './TripForm';

describe('departure time conversion', () => {
  it('uses the origin zone instead of the browser zone', () => {
    expect(localDepartureToUTC('2026-10-18T08:00', 'America/Denver')).toBe('2026-10-18T14:00:00Z');
    expect(localDepartureToUTC('2026-10-18T08:00', 'America/Chicago')).toBe('2026-10-18T13:00:00Z');
  });
  it('requires a choice for an ambiguous autumn time', () => {
    expect(() => localDepartureToUTC('2026-11-01T01:30', 'America/Denver')).toThrow();
    expect(localDepartureToUTC('2026-11-01T01:30', 'America/Denver', 'earlier')).toBe(
      '2026-11-01T07:30:00Z',
    );
    expect(localDepartureToUTC('2026-11-01T01:30', 'America/Denver', 'later')).toBe(
      '2026-11-01T08:30:00Z',
    );
  });
  it('rejects nonexistent spring times even when an offset is selected', () => {
    for (const choice of ['reject', 'earlier', 'later'] as const)
      expect(() => localDepartureToUTC('2026-03-08T02:30', 'America/Denver', choice)).toThrow();
  });
});
describe('trip form contract', () => {
  const values: FormValues = {
    origin: SAMPLE_ORIGIN,
    destination: SAMPLE_DESTINATION,
    departure: '2026-10-18T08:00',
    load: '40001',
    spacing: 25,
    offsetChoice: 'reject',
  };
  it('preserves load precision and creates the API request in UTC', () => {
    expect(formToInput(values, 'sample')).toMatchObject({
      departure_at: '2026-10-18T14:00:00Z',
      load_lb: 40001,
      spacing_miles: 25,
      mode: 'sample',
    });
  });
  it('rejects missing places and invalid loads', () => {
    expect(() => formToInput({ ...values, origin: null }, 'live')).toThrow('Choose an origin');
    for (const load of ['', '-1', 'NaN', 'Infinity'])
      expect(() => formToInput({ ...values, load }, 'sample')).toThrow('load weight');
  });
  it('allows an empty truck and formats route totals', () => {
    expect(formToInput({ ...values, load: '0' }, 'sample').load_lb).toBe(0);
    expect(formatDuration(3570)).toBe('1 hr 0 min');
    expect(miles(1609.344)).toBe(1);
  });
});
