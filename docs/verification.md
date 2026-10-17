# Verification record

Checked on 18 October 2026. The initial deployment record is below; the latest sidebar and tooltip
verification appears in the final interface section. Core routing CI passed for `0782af4`;
the service-status recovery update is covered by the frontend regressions in `64f7b0c`.

- 134 backend tests passed, with Ruff and Django system checks clean.
- 27 frontend unit tests passed. The production build and 10 desktop/mobile browser scenarios passed.
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

An open tab initially retained the pre-configuration health response after deployment. Service
status now refreshes on window focus, with a Recheck service control
when unavailable. Regression tests verify recovery preserves the form, trip, route selection,
and forecast hour without planning another route or fetching the corridor again.

The revised workspace opens with an editable example and no mode tabs. Every manual Find routes
submission uses live routing. Clear trip removes route and forecast data, including when an older
request completes afterward. Tests cover editing the example, clearing, late responses, and hourly
scrubbing. Assumptions are documented; blocked and incomplete route states stay visible.

## Latest sidebar and tooltip pass

The three initial requested fixes were committed as `a6f632b` before the deeper UI review.
The follow-up commits `0f67517` and `e0cec65` reflect the user's clarified preference for roomier tall-screen spacing, a 12px
Destination label gap, and a 12px dropdown-arrow inset.

| Viewport | Sidebar visible / content height | Final route bottom | Input height |
| --- | --- | --- | --- |
| 1280×720 | 668 / 668px | 712.7px | 40px |
| 1440×900 | 836 / 836px | 888px | 44px |
| 1440×1000 | 936 / 936px | 988px | 44px |

The default form and all three routes fit without desktop sidebar scrolling. At 320px and 390px,
inputs remained 44px tall with no horizontal page overflow; the mobile layout scrolls vertically.
Destination label gap and dropdown arrow inset measured 12px. Error messages and shorter windows
retain scrolling so content is not hidden to obtain a fit.

27 frontend unit tests, the production build, and 10 desktop/mobile browser scenarios passed.
The tooltip regression covers hover, keyboard focus, tap, Escape, and preserving route selection.
Actual browser checks confirmed all four risk-stat tooltips fit at 1440px, 390px, and 320px,
closed with Escape, opened on tap, and did not change the selected route.
Backend checks passed 134 tests and the Django system check. Production-mode `check --deploy`
exited successfully with the existing HSTS-disabled warning.

The [UI review](ui-review.md) records outstanding findings separately from these implemented changes.

The later route-only scrolling change was checked at 1280×600. The route viewport was 160px tall
with 288px of content; mouse-wheel scrolling reached the final card at scrollTop 128px. The form
remained at y=52px and the sidebar's own scrollTop remained zero. Keyboard focus reached the last
card's statistics inside the visible route viewport. The production build and all 10 browser
scenarios passed again for this CSS change.

## Route summary colors and zero values

45 frontend unit tests, 134 backend tests, the production build, formatting, and 12 desktop/mobile
browser scenarios passed. Tests cover exact average-color boundaries, unknown averages, tiny
positive values, zero summaries, blocked routes with low averages, and route-list tooltip overflow.
Backend checks remain clean apart from the previously documented HSTS deployment warning.

Zero Severe/High mileages and zero averages are hidden; the default cards now show High 50 mi /
Avg risk 1.45, Avg risk 0.26, and High 250 mi / Avg risk 0.85. Route A's No Travel 175 mi warning
remains visible. Numerical weather zeroes and the forecast's +0 hr frame remain available.

All six visible summary tooltips were exercised at 1440×900, 1280×600, 390×844, and 320×760.
They stayed within the window, remained hoverable, dismissed with Escape, and preserved route
selection. At 1280×600, scrolling the 160px route viewport to scrollTop 128px dismissed a tooltip
whose trigger left view; the last route's average tooltip remained readable and the form stayed
at y=52px. No horizontal page overflow was present.

Checkpoint and corridor popup badges matched the checkpoint table in the browser. At 390px,
the No Travel badge and 44px close button did not overlap. Map and heatmap colors retain their
fixed legend. Shared status styling also covers warnings, errors, and keyboard focus.

Measured text/background contrast ratios: Low 5.70:1, Moderate 5.55:1, High 5.21:1, Severe 5.95:1,
No Travel 12.23:1, Unknown 4.88:1. The focus token contrasts 6.16:1 against white.
Average colors are presentation bands, not a classification of the route's worst conditions.

The deployed [risk-color preview](https://spotter-775a6fbgw-xeli-staging.vercel.app/) matched these
values and colors. Its 1440×1000 workspace had 936px sidebar content in 936px available, with
all three cards visible. The public application alias points to this deployment.
The browser regression also covers the smaller route viewport when live routes are unavailable;
it moves the pointer away before scrolling so a newly hovered stat does not obscure dismissal
of the original tooltip. The README screenshot reflects the deployed interface.

## Remaining delivery item

The [seven-minute walkthrough script](walkthrough.md) is ready. A Loom recording and upload have
not been made. Free-provider quotas and temporary service outages can pause live planning; the
default example remains available.
