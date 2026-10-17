import { z } from 'zod';

export const levels = ['low', 'moderate', 'high', 'severe', 'no_travel', 'unknown'] as const;
export const riskLevelSchema = z.enum(levels);
export type RiskLevel = z.infer<typeof riskLevelSchema>;
const coordinate = z.array(z.number()).min(2);
const lineString = z.object({ type: z.literal('LineString'), coordinates: z.array(coordinate).min(2) });
export const locationSchema = z.object({ label: z.string(), lat: z.number(), lon: z.number(), timezone: z.string() });
export type Location = z.infer<typeof locationSchema>;
const weatherSchema = z.object({ wind_mph: z.number(), gust_mph: z.number().nullable(), rain_in_hr: z.number(), snow_in_hr: z.number() });
const checkpointSchema = z.object({
  id: z.string(), lat: z.number(), lon: z.number(), distance_meters: z.number(), elapsed_seconds: z.number(), eta: z.string(),
  weather: weatherSchema.nullable(), risk: z.object({ level: riskLevelSchema, score: z.number().nullable(), reasons: z.array(z.string()) }),
});
export type Checkpoint = z.infer<typeof checkpointSchema>;
const segmentSchema = z.object({
  type: z.literal('Feature'), geometry: lineString,
  properties: z.object({ route_id: z.string(), level: riskLevelSchema, start_checkpoint_id: z.string(), end_checkpoint_id: z.string() }),
});
const routeSchema = z.object({
  id: z.string(), label: z.string(), distance_meters: z.number(), duration_seconds: z.number(), geometry: lineString,
  checkpoints: z.array(checkpointSchema), segments: z.object({ type: z.literal('FeatureCollection'), features: z.array(segmentSchema) }),
  summary: z.object({
    status: z.enum(['eligible', 'blocked', 'incomplete']), arrival_at: z.string(),
    risk_miles: z.object({ low: z.number(), moderate: z.number(), high: z.number(), severe: z.number(), no_travel: z.number(), unknown: z.number() }),
    average_risk: z.number().nullable(), severe_miles: z.number(), high_miles: z.number(),
  }),
});
export type Route = z.infer<typeof routeSchema>;
export const tripSchema = z.object({
  id: z.string(), mode: z.enum(['sample', 'live']), origin: locationSchema, destination: locationSchema, departure_at: z.string(),
  load_lb: z.number(), spacing_miles: z.union([z.literal(10), z.literal(25), z.literal(50)]), routes: z.array(routeSchema).max(3),
  recommended_route_id: z.string().nullable(), recommendation_reason: z.string(), warnings: z.array(z.string()), weather_fetched_at: z.string(), expires_at: z.string(),
});
export type Trip = z.infer<typeof tripSchema>;
export const corridorSchema = z.object({
  trip_id: z.string(), departure_at: z.string(), hours: z.array(z.string()).length(49), cell_size_miles: z.number(),
  cells: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.object({
    type: z.literal('Feature'), geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(coordinate)) }),
    properties: z.object({
      id: z.string(), risks: z.array(z.number().min(0).max(4).nullable()).length(49),
      wind_mph: z.array(z.number().nullable()).length(49), rain_in_hr: z.array(z.number().nullable()).length(49), snow_in_hr: z.array(z.number().nullable()).length(49),
    }),
  })) }), warnings: z.array(z.string()),
});
export type Corridor = z.infer<typeof corridorSchema>;
export const healthSchema = z.object({ live_available: z.boolean(), missing_configuration: z.array(z.string()).optional().default([]) }).passthrough();
export const geocodeSchema = z.object({ results: z.array(locationSchema), live_available: z.boolean() });
export type PlanInput = { mode: 'sample' | 'live'; origin?: Location; destination?: Location; departure_at: string; load_lb: number; spacing_miles: 10 | 25 | 50 };
