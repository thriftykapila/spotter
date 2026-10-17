# Verification record

Checked on 18 October 2026 for source commit `0782af4`.

- 134 backend tests passed, with Ruff and Django system checks clean.
- 19 frontend unit tests passed. The production build and desktop/mobile browser suite passed.
- [GitHub Actions](https://github.com/thriftykapila/spotter/actions/runs/39074372989) passed all three jobs.
- The deployed API imported Django, Shapely, pyproj, and timezonefinder on CPython 3.13.15.
- No provider keys were found in tracked files. Local credentials are in an ignored file with 0600 permissions;
  deployed credentials are backend environment values.

## Live flow

The browser selected TomTom geocoding results for Denver, CO and Kansas City, MO, then submitted
18 October at 08:00 in America/Denver. The API received 14:00 UTC. With 35,000 lb and 25-mile
spacing, it returned three eligible routes with 26, 29, and 27 checkpoints. All checkpoints had
weather. Equal weather risk meant the shortest travel time determined the recommendation.

On the deployed preview, route assessment took about 3.4 seconds and the separate corridor request
about 2.2 seconds. The corridor contained 168 cells and 49 hourly frames, with no unknown weather
or provider warnings. These are observations from one trip, not response-time guarantees.

An earlier live test found dense road geometry made corridor buffering exceed the request budget.
Corridor-only 50-meter simplification and buffering each route before merging reduced its geometry
work to about 0.11 seconds on the saved 21,356-vertex trip. Original road geometry, checkpoints,
provider timing, and route assessments are retained. A dense-route regression test covers this case.

## Map and controls

The sample trip was checked on desktop and mobile, including all three route choices, checkpoint
selection, the accessible checkpoint list, and forecast-only retry. At 390px width there was no
horizontal overflow. WebGL failure has a usable checkpoint-list fallback.

All 49 sample forecast frames were scrubbed without additional API requests or recommendation
changes. On Headless Chrome 155 at 1440×900, 24 native keyboard slider inputs reached the first
animation callback in a median 11.2 ms and p95 12.6 ms. The second callback had p95 29.3 ms.
This measures callback scheduling; it does not measure completed GPU rendering or INP.

The live trip also passed all 49 slider frames without API calls or changed route summaries.
Its checkpoint list and map popup showed real ETA, wind, gusts, rain, snowfall, and risk reasons.
The live interface retained its 390px mobile layout with the checkpoint table expanded.

## Remaining delivery item

The [seven-minute walkthrough script](walkthrough.md) is ready. A Loom recording and upload have
not been made. Free-provider quotas and temporary service outages can pause live planning; the
labeled sample remains available.
