# UI and UX review — 18 October 2026

The first three requested fixes were committed in `a6f632b` before this review began:
sidebar density, the Destination label gap shown in the supplied screenshot, and the spacing
dropdown arrow inset. A subsequent user review requested more breathing room on taller screens,
simpler route statistics, and metric tooltips. The final clarification requests a 12 px Destination
label gap and 12 px arrow inset; it replaces the original zero-spacing request.
Those refinements are separate from the outstanding
findings below.

## Required data and presentation choices

| Data | Relationship to the brief | Presentation |
| --- | --- | --- |
| Severe miles and High miles | Explicit first and second recommendation criteria | Show positive exposure; hide zeroes and omit unnecessary `.0` decimals. |
| Average risk | Explicit third recommendation criterion | Keep the calculation; use “Avg risk” and explain the 0–4 scale in a tooltip. `/4` is not mandated. |
| Travel time and ETA | Explicit travel-time comparison and checkpoint ETA requirements | Keep visible. |
| No Travel exposure | Comes from the supplied risk/load thresholds; these routes are excluded | Keep the unsafe-route indication visible. |
| Highway names and total distance | Useful contents of the requested route summaries | Keep concise, on one summary line where space allows. |
| Default example values | A convenience for trying the app, not real forecasts | Clearly distinguish their provenance from live results. |

Risk calculations and ranking retain full precision. Display formatting must not turn a tiny positive
risk exposure into zero; values below 0.1 mile are shown as `<0.1`.

## Findings still open

HIGH means the interface can communicate or select the wrong trip information. MEDIUM means a
verified interaction or accessibility problem. LOW means isolated polish. Findings are from actual
browser reproduction or computed styles, with source references to the reviewed code.

| Severity | Location | Before / evidence | Proposed fix | Why |
| --- | --- | --- | --- | --- |
| HIGH | `frontend/src/TripForm.tsx:111`, `:126` | Load Denver suggestions, replace the text with New York, and press Enter within the 300 ms debounce. Denver is selected because the previous query's options remain selectable. | Only display or accept options when their query matches the current input; clear the active option immediately when text changes. | A keyboard user can plan a trip from the wrong city. |
| HIGH | `frontend/src/App.tsx:14`, `:69`, `:149` | The app automatically loads synthetic results, but the visible results contain no sample/synthetic provenance. The warning filter drops that information. | Add a small result caption or map attribution identifying example data. Do not restore the removed header buttons or notes sections. | A visitor can mistake illustrative weather and unsafe-mile values for current forecasts. This follows the requested removal of the previous labels. |
| MEDIUM | `frontend/src/TripForm.tsx:119`, `frontend/src/styles.css:352` | With five location suggestions, ArrowDown can activate an option below the menu's visible bottom while `scrollTop` remains zero. The active fifth option was entirely outside the 250 px menu. | Scroll the active option into the menu with nearest alignment after keyboard selection. | Users should see the location that Enter will choose. |
| MEDIUM | `frontend/src/api.ts:26`, `frontend/src/App.tsx:130` | A mocked server departure-validation error says “Check the highlighted inputs,” but zero inputs have `aria-invalid`; server field details are discarded. | Preserve server field errors, attach each to its field, and focus the first invalid field. | The message gives an instruction the interface cannot fulfill. |
| MEDIUM | `frontend/src/TripMap.tsx:418` | Open a checkpoint, close its popup, then select the same checkpoint again. The row remains active but the popup stays closed because the same selected object is reused. Forecast changes can also remove the popup without clearing selection. | Synchronize popup closure with selection, or use a selection event counter so repeated selection reopens details. | An apparently working checkpoint action can stop responding. |
| MEDIUM | `frontend/src/TripMap.tsx:277` | Fit Route B at 1280 px, then narrow to 1024 px. Denver and Kansas City move outside the map edges until Fit is pressed. The observer resizes the canvas without refitting. | Refit on container changes while the user is in a fitted view; preserve deliberate manual pan/zoom. | The selected trip should remain inspectable after resizing. |
| MEDIUM | `frontend/src/TripMap.tsx:220` | With Route B selected, clicking the shared Kansas City endpoint can select Route C's checkpoint. The handler takes the first overlapping rendered feature. | Prefer the selected route's checkpoint; identify the route and checkpoint in the popup. | Shared endpoints should not silently switch the inspected route. |
| LOW | `frontend/src/styles.css:885` | At 320 px, the forecast information popup extends about 11 px beyond its clipping map container. | Constrain or align the popup to the forecast container on narrow screens. | Part of the explanation is hidden. |
| LOW | `frontend/src/styles.css:337` | The clock-change choice select computes to 14 px on mobile while the other input text is 16 px. | Remove the smaller text override and retain 16 px for mobile form controls. | This creates inconsistent input text. Native Safari zoom behavior was not verified. |

The HIGH findings prevent a complete UI sign-off: **Block** that sign-off until they are resolved.
The requested spacing and presentation changes are independently verified; this verdict does not
mean those changes failed. The remaining review findings have not been implemented.

## Resolved in the risk-color pass

The pale keyboard-focus outline now uses the shared blue `#245cc5` focus token: 6.16:1 against
white. The former MEDIUM focus-contrast finding is resolved. The nine findings above remain open.
Route risk pills, checkpoint badges, and popup titles now share semantic colors with explicit text.

## Verification and limits

- The initial compact layout at `a6f632b` fit the default form and all three routes at 1280×720:
  sidebar client height 668 px, scroll height 668 px, final route bottom 714.5 px. 1366×768,
  1440×900, and 1024×768 also fit. Destination label gap and arrow right inset both measured 0 px.
- The follow-up layout restores normal-height controls and uses spare vertical space on taller
  desktops, with a compact fallback for short screens. Its final measurements are recorded in
  [verification.md](verification.md).
- Form checks used controlled location suggestions and failed live responses, without provider
  calls. Clear-trip and late-response guards remained correct in the inspected cases.
- Map checks covered route selection, shared checkpoints, popup close/reopen, resizing, forecast
  scrubbing, heatmap toggling, partial forecast recovery, and the accessible checkpoint table.
- At 390 px, checkpoint selection brought the popup into view and focused its close button.
  The page did not overflow horizontally. Narrow 320 px and short 1280×480 layouts were checked.
- Reflow was exercised with reduced effective width/text scaling. Native OS/browser 200% zoom,
  physical iPhone Safari, Firefox, and screen-reader speech were **not verified**. Keyboard and
  accessible-name checks do not constitute a full accessibility certification.
- A MapLibre array/string warning reproduced on map-feature querying, but no visible forecast-color
  corruption was confirmed. It is an investigation note, not a claimed risk-rendering failure.

The review used the project's restrained UI contract, the local layout/UI/accessibility skills, and
[Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
