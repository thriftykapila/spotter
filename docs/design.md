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
- Synthetic demo is labeled persistently. Live failures never silently become sample weather.

## Planning flow

The app opens with an example Denver–Kansas City trip. A small Sample trip badge identifies it.
There is one editable form and no sample/live navigation. Find routes always requests live routing;
Clear trip removes the example, inputs, routes, checkpoints, and forecast. Load example restores it.
Clearing must also ignore an older in-flight request so sample results cannot reappear unexpectedly.

Keep the form visible beside compact route rows and a large map. Use a consistent control system:
44px inputs and actions, 8px corners, subtle borders, restrained blue selection, and clear focus.
Place the load and checkpoint spacing controls on one row. Put assumptions and detailed explanations
behind Trip notes, Why this route?, and checkpoint disclosures. Blocked routes, missing weather,
and actionable request errors remain visible. Avoid taglines, repeated instructions, service
implementation details, and explanatory paragraphs around the map and timeline.

## Skills

New installs from openai/skills revision `49f948faa9258a0c61caceaf225e179651397431`:
`playwright`, `vercel-deploy`.

Already available: `better-layout`, `better-typography`, `better-colors`, `better-ui`,
`fixing-accessibility`, `vercel-react-best-practices`, `web-design-guidelines`, `ui-ux-pro-max`.
The design contract takes precedence over generated style suggestions. Supporting research
must fit a route planning application before it is used.
