import { z } from 'zod';
import { corridorSchema, geocodeSchema, healthSchema, tripSchema, type PlanInput } from './types';

const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(message: string, public status: number, public code = 'request_failed') { super(message); }
}
async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`${base}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
  catch { throw new ApiError('Cannot reach the routing service. Check your connection and try again.', 0); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.object({ message: z.string(), code: z.string().optional() }) }).safeParse(body);
    throw new ApiError(error.success ? error.data.error.message : `The routing service returned ${response.status}. Please try again.`, response.status, error.success ? error.data.error.code : undefined);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError('The routing service returned an incomplete response. Please try again.', 502, 'invalid_response');
  return result.data;
}
export const getHealth = () => request('/health', healthSchema);
export const geocode = (q: string, signal?: AbortSignal) => request(`/geocode?q=${encodeURIComponent(q)}`, geocodeSchema, { signal });
export const planTrip = (input: PlanInput) => request('/trips/plan', tripSchema, { method: 'POST', body: JSON.stringify(input) });
export const getCorridor = (tripId: string, signal?: AbortSignal) => request(`/trips/${encodeURIComponent(tripId)}/corridor`, corridorSchema, { signal });
