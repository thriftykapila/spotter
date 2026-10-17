# Shared API contract

All API paths start `/api/`, with no required trailing slash. Distances are meters internally,
elapsed time is seconds, load is pounds, weather is mph and inches/hour. UTC timestamps are
offset-aware ISO strings. Level names: `low`, `moderate`, `high`, `severe`, `no_travel`, `unknown`.

`GET /api/geocode?q=...` returns `{results: [{label,lat,lon,timezone}], live_available: bool}`.
US results only. `GET /api/health` returns readiness including `live_available` and
`missing_configuration` (names only, never secrets).

`POST /api/trips/plan` accepts `{mode: "sample"|"live",origin: Location,destination: Location,
departure_at: ISO,load_lb: number,spacing_miles: 10|25|50}`. In sample mode origin/destination may
be omitted; defaults are Denver and Kansas City. It returns:

```
{id,mode,origin,destination,departure_at,load_lb,spacing_miles,routes,
 recommended_route_id: string|null,recommendation_reason,warnings: string[],weather_fetched_at,expires_at}
```

Route: `{id,label,distance_meters,duration_seconds,geometry: GeoJSON LineString,
checkpoints: Checkpoint[],segments: GeoJSON FeatureCollection,summary: Summary}`.
Checkpoint: `{id,lat,lon,distance_meters,elapsed_seconds,eta,weather: Weather|null,
risk: {level,score: number|null,reasons: string[]}}`.
Weather: `{wind_mph,gust_mph,rain_in_hr,snow_in_hr}`.
Summary: `{status: "eligible"|"blocked"|"incomplete",arrival_at,risk_miles: {low,moderate,high,
severe,no_travel,unknown},average_risk: number|null,severe_miles,high_miles}`.
Each segment feature is a LineString with `{route_id,level,start_checkpoint_id,end_checkpoint_id}`.

`GET /api/trips/{id}/corridor` returns `{trip_id,departure_at,hours: ISO[49],cell_size_miles,
cells: GeoJSON FeatureCollection,warnings: string[]}`. Each polygon feature has properties
`{id,risks: (number|null)[49],wind_mph: (number|null)[49],rain_in_hr: (number|null)[49],
snow_in_hr: (number|null)[49]}`. Risks score 0..4. Unknown is null.

Errors: `{error: {code,message,fields?: object,retry_after?: number}}` with appropriate 400/404/
409/429/503/504 status. Trip analyses expire after 15 minutes. The sample mode must work without
credentials. Never fall back silently from live to sample. Frontend uses the same contract in both.

## Backend collaboration interfaces

`routing.domain`: `classify_weather(weather, load_lb) -> risk dict`,
`assess_route(route, departure_at, load_lb) -> route dict`,
`recommend_routes(routes) -> (recommended_id, reason)`.
`assess_route` expects checkpoints populated with weather and eta; produces segments/summary.

`routing.geometry`: `sample_route(route, departure_at, spacing_miles) -> checkpoints` consumes
normalized route geometry and `progress: [{point_index,distance_meters,duration_seconds}]`;
`corridor_grid(routes, max_cells=200) -> (GeoJSON FeatureCollection, cell_size_miles)`;
`segments_for_route(route) -> GeoJSON FeatureCollection` if needed internally.

`routing.demo`: `sample_trip(departure_at, load_lb, spacing_miles) -> full trip response` and
`sample_corridor(trip) -> corridor response`. All sample geometry/weather is synthetic and labeled.

The API/services worker owns providers, store, services, serializers, views and routing URLs.
The domain worker owns domain, geometry, demo and associated tests. Root owns config, dependency
files, docs, CI/deployment and final integration. Frontend worker owns frontend source/config/tests.
