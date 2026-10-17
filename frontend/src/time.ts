import { Temporal } from '@js-temporal/polyfill';

export type OffsetChoice = 'reject' | 'earlier' | 'later';
export function localDepartureToUTC(
  value: string,
  timezone: string,
  choice: OffsetChoice = 'reject',
): string {
  const local = Temporal.PlainDateTime.from(value);
  // Reject spring-forward gaps even when the user selected an autumn offset.
  const zoned = local.toZonedDateTime(timezone, { disambiguation: choice });
  if (!zoned.toPlainDateTime().equals(local))
    throw new RangeError(
      'This local time does not exist because clocks move forward. Choose another time.',
    );
  return zoned.toInstant().toString();
}
export function nextDeparture(timezone: string): string {
  return Temporal.Now.zonedDateTimeISO(timezone)
    .add({ hours: 1 })
    .with({ minute: 0, second: 0, millisecond: 0 })
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' });
}
export function formatTime(iso: string, timezone: string, full = false): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(full ? { year: 'numeric' } : {}),
  }).format(new Date(iso));
}
export const miles = (meters: number) => meters / 1609.344;
export const formatMiles = (meters: number) => `${Math.round(miles(meters)).toLocaleString()} mi`;
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}
