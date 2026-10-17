# Interface contract

Spotter is a practical route planning workspace. The map and route comparison are the product.

- System sans-serif, 16px form controls, tabular numbers, modest headings.
- White surfaces, neutral background, structural borders, consistent modest corners.
- Blue actions and selection. Low green, Moderate amber, High orange, Severe red, No Travel charcoal.
- Risk always has a text label. Unknown is gray and does not imply safety.
- Compact form and aligned route rows beside the dominant map; timeline at the map bottom.
- Visible input labels, inline associated errors, keyboard selection, 44px touch targets.
- Same checkpoint information is available in an accessible list.
- Mobile stacks form, summaries, map, and checkpoint details; test 375px and 200% zoom.
- No hero, decorative gradients, patterns, glass, fake metrics, nested cards or entrance animation.
- Document synthetic demo data and risk assumptions. Live failures never silently become sample
  weather.

## Planning flow

The app opens with an example Denver–Kansas City trip.
There is one editable form and no sample/live navigation. Find routes always requests live routing;
Clear trip removes the example, inputs, routes, checkpoints, and forecast.
Clearing must also ignore an older in-flight request so sample results cannot reappear unexpectedly.

Keep the form visible beside compact route rows and a large map. Use a consistent control system:
44px inputs and actions, 8px corners, subtle borders, restrained blue selection, and clear focus.
On desktop windows up to 800px tall, use 40px controls and tighter vertical spacing so the default
form and all three routes fit. Taller windows distribute spare height between route choices and
retain comfortable form spacing. Mobile retains 44px inputs and normal document scrolling.
On desktop, the route cards scroll independently when space is limited; the form and Routes
heading stay in place. Keep the card sizing and spacing unchanged when enabling this overflow.
Origin and Destination share aligned input edges with a 12px label gap. The spacing dropdown
arrow has a 12px inset from the trailing edge.
Place the load and checkpoint spacing controls on one row. Keep assumptions and route-ranking
explanations in project documentation. Checkpoint details, blocked routes, missing weather,
and actionable request errors remain visible. Avoid taglines, repeated instructions, service
implementation details, and explanatory paragraphs around the map and timeline.

Route statistics omit unnecessary decimal zeroes and use clear labels: Severe, High, and Avg risk.
Keep fractional exposure when needed. Brief stat tooltips work on hover, keyboard focus, and tap;
Escape dismisses them. Inspecting a statistic must not select a different route.

## Skills

New installs from openai/skills revision `49f948faa9258a0c61caceaf225e179651397431`:
`playwright`, `vercel-deploy`.

Already available: `better-layout`, `better-typography`, `better-colors`, `better-ui`,
`fixing-accessibility`, `vercel-react-best-practices`, `web-design-guidelines`, `ui-ux-pro-max`.
The design contract takes precedence over generated style suggestions. Supporting research
must fit a route planning application before it is used.
