# Risk and timing assumptions

## Exact boundaries

The brief overlaps some decimal endpoints. Spotter resolves these toward the higher category,
while preserving the explicitly strict No Travel rain and snow thresholds.

| Hazard | Low | Moderate | High | Severe | No Travel |
| --- | --- | --- | --- | --- | --- |
| Wind (mph) | <25 | 25 ≤ x <35 | 35 ≤ x <45 | 45 ≤ x <55 | ≥55 |
| Rain (in/hr) | <0.10 | 0.10 ≤ x <0.25 | 0.25 ≤ x <0.50 | 0.50 ≤ x ≤1.00 | >1.00 |
| Snow (in/hr) | <0.5 | 0.5 ≤ x <1.0 | 1.0 ≤ x <2.0 | 2.0 ≤ x ≤3.0 | >3.0 |

Load overrides affect wind risk:

- Wind ≥55 mph: No Travel for every load.
- 45 ≤ wind <55 mph and load **>30,000 lb**: No Travel.
- 35 ≤ wind <45 mph and load **>40,000 lb**: Severe.

Exactly 30,000 or 40,000 lb does not trigger its corresponding strict comparison.
Measurements are never rounded before classification. Values shown in the UI may be rounded.
Checkpoint risk is the maximum wind-after-load-adjustment, rain, and snow risk.

## Distance and recommendation

Scores are Low=0, Moderate=1, High=2, Severe=3, No Travel=4. Missing measurements produce Unknown.

Each interval between neighboring checkpoints receives the worse endpoint risk. This is a
conservative sampled estimate; weather between samples is not continuously known. Band miles
sum to total route distance, including the final partial interval.

`average risk = sum(interval miles × interval score) / total miles`

Any No Travel condition blocks a recommendation. Any interval lacking required weather makes
the route incomplete. Rank complete, unblocked routes lexicographically by Severe distance,
High distance, average risk, and duration, with a stable ID only for exact ties. A shorter route
never buys its way past a worse Severe-mile result.

## Checkpoint arrival times

Sample positions are defined using provider distance progress, retaining origin and destination.
Cumulative geometry distances interpolate positions and time between surrounding progress entries.
Different segments may have different speeds. The final ETA equals the provider route duration.
Breaks and hours-of-service planning are not included.

The origin time zone is displayed beside departure. API timestamps are aware UTC. Invalid or
ambiguous DST local times require correction or an explicit offset rather than silently shifting time.

## Forecast intervals and units

Open-Meteo rain, showers, snowfall, and gusts describe the preceding hour. An ETA at 10:15 uses
the accumulation ending at 11:00; an ETA exactly at 11:00 uses that ending interval. Sustained
wind is instantaneous and is linearly interpolated between hourly timestamps.

Rain rate is hourly `rain + showers` in inches. Total precipitation includes snow and is not
used as liquid rain. Snowfall is fresh snow accumulation, not water equivalent or existing snow
depth. Sustained 10m wind determines supplied wind bands; gusts remain visible context.

Missing fields, unsupported hours, and unavailable forecasts are never treated as zero.

## Forecast heatmap

This is a sampled forecast grid, not a density visualization. Route overlap and checkpoint spacing
do not intensify its colors. Each cell has the same fixed risk legend at every zoom/hour. The grid
is clipped to the union of ±25-mile route corridors, starting at 10-mile cells and increasing in
5-mile steps until at most 200 cells remain. Cell resolution is approximate and disclosed.

To keep dense road geometry within the response deadline, corridor outlines use projected route
lines simplified with a 50-meter tolerance before buffering each line and merging the buffers.
This approximation applies only to the forecast corridor. Route lines, checkpoint positions,
arrival times, and route risk mileage retain the provider's original geometry and progress.

Frames are departure plus 0 through 48 hours. They are independent of checkpoint arrival-time
assessment. Moving the slider never changes the recommendation. Coarse cells can miss local
weather variation; authoritative displayed route scores come from the checkpoint calculations.
