# Seven-minute Loom walkthrough

Use the labeled synthetic trip for reproducibility, then show a live trip if credentials are configured.
Keep the browser at a readable desktop width. The route comparison, map, and timeline should remain
visible together. Do not show secret environment values or account tokens while recording.

| Time | Show and explain |
| --- | --- |
| 0:00–0:40 | State the problem: route weather must match arrival time. Introduce origin, destination, departure, load, and spacing. Point out the synthetic-demo label. |
| 0:40–1:40 | Compare the three routes. Explain the recommendation using Severe miles, High miles, average risk, then time. Select another route and show its highlighted geometry. |
| 1:40–2:40 | Select a checkpoint. Show its distance, ETA, sustained wind/gust, rain, snowfall, risk, and explanation. Open the accessible checkpoint list. |
| 2:40–3:30 | Change load across a strict threshold and compare again. Show why the wind/load rule can block a route. Explain why No Travel options are excluded. |
| 3:30–4:20 | Change 25-mile spacing to 10 or 50. Explain origin/destination inclusion, partial final intervals, and sampled-risk mileage. |
| 4:20–5:20 | Enable the corridor heatmap and scrub 0–48 hours. Show timestamps, fixed legend, disclosed cell resolution, and unchanged route ranking. Mention that slider frames are prefetched. |
| 5:20–6:00 | Show the mobile layout or narrow the window. Demonstrate keyboard route selection, the range slider, and equivalent checkpoint information outside the map. |
| 6:00–6:40 | Show repository structure, focused tests, and CI. Explain React/Django, TomTom, Open-Meteo, and Vercel + shared Redis. |
| 6:40–7:00 | State practical limits: synthetic sample, forecast uncertainty, no break planning or configured vehicle-specific restrictions, and fewer alternatives when the API returns fewer. End on the application. |

Before recording, run tests and use a fresh trip so its temporary analysis has not expired. For a
live demonstration, enter a real US trip, use the origin time zone, and allow providers to respond.
Show missing data honestly rather than changing silently to demo weather.

After recording, put the hosted application URL and Loom URL near the top of README.md. Suggested
Loom title: **Spotter — weather-aware truck routing walkthrough**.
