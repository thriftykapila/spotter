# Deploy on Vercel Hobby

The intended deployment has two projects in one Vercel account and one Upstash Redis Free database.
Vercel Hobby and the selected weather service are for a personal noncommercial demonstration.

## Backend first

Current API preview: `https://spotter-131xcf7oy-xeli-staging.vercel.app`.
Current public frontend: [spotter-web-swart.vercel.app](https://spotter-web-swart.vercel.app).
Both projects are on the existing `xeli-staging` Hobby workspace.

1. Import `thriftykapila/spotter` in Vercel. Set the root directory to `backend` and framework to Django.
2. Select Python 3.13. The repository uses a uv lockfile and `config.wsgi:application` entrypoint.
3. Set `DJANGO_SECRET_KEY` to a newly generated random secret in Vercel environment settings.
4. Set `DJANGO_DEBUG=false` and `DJANGO_ALLOWED_HOSTS` to the backend host (plus preview hosts if used).
5. Add `TOMTOM_API_KEY`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` for live routing.
6. Deploy. The sample flow remains available without the live-provider credentials.

Do not store signing or provider credentials in repository files. Generate a signing secret locally
with `python3 -c 'import secrets; print(secrets.token_urlsafe(64))'` and paste it into Vercel settings.
Do not publish that command's output or commit local `.env` files.

The backend health endpoint reports configured capability and native dependency availability. It
does not reveal secrets. Vercel packages Django as a Python Function; no Gunicorn server is needed.
Native Shapely/pyproj/timezonefinder imports must pass on Linux before declaring the deployment ready.

## Frontend

1. Import the same repository as a second project with root `frontend` and framework Vite.
2. Set Node to 24.x. Use `npm ci`, `npm run build`, and output directory `dist`.
3. From the repository root, run:

   ```bash
   python3 scripts/configure-hosting.py https://YOUR-BACKEND.vercel.app
   ```

4. Commit the rewrite change and deploy the frontend. The browser calls `/api/*` on its own origin.
5. Optionally set `VITE_TOMTOM_MAP_KEY` to a separate browser-restricted Map Display key.

The initial rewrite hostname is a placeholder until configured. Never point it to a different owner's
unverified application. Preview URLs may need deployment protection adjusted for evaluator access
and frontend-to-backend rewrites. Account-owned stable URLs are preferred for final submission.

## Shared caching and quotas

In-memory state cannot enforce global limits across serverless instances. Live mode uses Upstash
REST for forecast TTLs, temporary trip analyses, duplicate-request locks, and atomic quota counters.
The configured guard leaves headroom under the weather provider's minute/hour/day limits. Batch
HTTP requests still consume provider allowance per location, not per HTTP call.

Live assessment allows at most 300 unique checkpoint coordinates and 200 corridor cells. An
oversized checkpoint request asks for coarser spacing. Forecast frames are prefetched once and
the slider makes no requests. Redis unavailability stops live upstream requests; sample mode works.

## Verification before sharing

- Open the preview in a browser and confirm the synthetic trip, three alternatives, and checkpoint details.
- Confirm the native dependency health report on the deployed backend.
- Check `/api/*` works through the frontend rewrite and does not expose credentials.
- Change load, departure, and spacing; confirm the result reflects them.
- Scrub 0–48 hours with the network panel open; no forecast/routing requests should occur.
- Verify a 375px viewport, keyboard controls, and the accessible checkpoint list.
- When keys are configured, run a real route and confirm arrival-time weather and attribution.
- Confirm exhausted quota, missing credentials, and unavailable forecasts are explicit states.

Cold starts and third-party response times remain possible. Free-tier quota exhaustion can pause
features. Check account dashboards before recording the walkthrough. A custom domain is optional;
Vercel preview/project domains are sufficient for evaluation.

Git-triggered Vercel deployments are explicitly disabled in both configs while provider setup is
pending. GitHub Actions still runs on pushes. Deploy previews deliberately with `--target preview`
and the matching project ID from the repository root; deployment settings use the backend/frontend
root directories. After any backend preview changes, run the rewrite configuration script again.

## Stay on free plans

- Use Vercel Hobby and Upstash Free. Do not attach billing or choose a paid/trial plan.
- Keep TomTom billing unconfigured; use only the routing/geocoding products needed by Spotter.
- The shared TomTom guard allows at most 500 routing/geocoding calls combined per UTC day,
  including retries. Even a 31-day month stays at 15,500, below either 20,000-request free allowance.
- Open-Meteo is guarded at 550 weighted locations/minute, 4,500/hour, and 9,000/day.
- Provider denial, exhausted budgets, or Redis failure stops live work instead of bypassing limits.
- Provider account dashboards remain authoritative for usage. Requests made outside this app
  are not counted by Spotter's guards. Keep these new account credentials dedicated to this project.

Sources: [Django on Vercel](https://vercel.com/docs/frameworks/full-stack/django),
[function limits](https://vercel.com/docs/functions/limitations),
[Hobby plan](https://vercel.com/docs/plans/hobby), [Upstash](https://upstash.com/pricing/redis).
