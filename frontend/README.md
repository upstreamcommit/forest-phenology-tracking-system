# Forest Phenology Explorer (frontend)

A React app for the FPTS API: a map of stored phenology metrics (start, end and length of the
growing season) on the synthetic 0.1° grid over Great Britain, with per-point details.
All data it shows is synthetic, and the app says so.

## Stack

React 19, React Router 8, TanStack Query 5, MapLibre GL 6 with OpenFreeMap basemaps (no API
key), Tailwind CSS 4 over semantic design tokens (light and dark), TypeScript 6, Vite 8.
Tests: Vitest, Testing Library and MSW for units and components; Playwright with axe for
end-to-end and accessibility checks.

## Run it

Node `^22.22.2 || >=24.15.0` (see `engines` in `package.json`).

```bash
npm ci
npm run dev
```

The dev server proxies the API paths (`/catalog`, `/phenology`, `/health`, `/docs`,
`/openapi.json`) to `http://localhost:8000`, so start the backend first (`docker compose up
--build` from the repository root). Point it elsewhere with `FPTS_API_URL=http://host:port npm run dev`.
The app calls the API on its own origin, so the API needs no CORS.

| Task | Command |
|---|---|
| Unit and component tests | `npm test` (`npm run test:watch` while developing) |
| End-to-end and accessibility tests | `npm run e2e` (first time: `npx playwright install chromium`) |
| Lint | `npm run lint` |
| Type-check and build | `npm run build` |

The end-to-end tests build the app with `VITE_BASEMAP=none` (no map tiles) and mock the API
with the fixtures in `src/test/fixtures.ts`, so they need neither the backend nor the network.

## Layout

- `src/api/`: `schema.gen.ts` (generated OpenAPI types), `types.ts`, `client.ts` (`fetchJson`
  and `ApiError`, which turns the API's four error shapes into one `kind`), `endpoints.ts`,
  `queries.ts` (TanStack Query hooks and keys).
- `src/app/`: app, router, shell (header, API status, theme, synthetic-data banner), error and
  404 pages.
- `src/components/`: small shared UI primitives.
- `src/features/`: `map/` (map explorer), `point-panel/` (selected point), `charts/`
  (hand-built SVG charts), `about/` (data and methods).
- `src/lib/`: dates (UTC-safe), formatting, theme, error wording.
- `src/styles/index.css`: design tokens. Components use token classes such as `bg-surface` or
  `text-ink-muted`, never raw colours, so both themes stay in step.
- `src/test/`: test setup, MSW handlers and fixtures. `e2e/`: Playwright tests.

## API types

`src/api/schema.gen.ts` is generated from the API's OpenAPI document. After API changes,
regenerate it from the repository root (`openapi-typescript` 7 needs TypeScript 5, so it runs
in a throwaway `npx` environment rather than as a project dependency):

```bash
PHENOLOGY_REPO_BACKEND=memory poetry run python -c "import json; from fpts.api.main import create_app; print(json.dumps(create_app().openapi(), indent=1, sort_keys=True))" > /tmp/openapi.json
npx -y -p openapi-typescript@7.13.0 -p typescript@5.9.3 openapi-typescript /tmp/openapi.json -o frontend/src/api/schema.gen.ts
```

Then restore the two-line header comment and run `npm run build` to catch type changes.

## Notes

- Grid coordinates go back to the API exactly as received (`String(number)` round-trips
  doubles), because stored lookups match latitude and longitude by exact equality.
- API dates are calendar dates; `src/lib/dates.ts` handles them in UTC so they never shift a
  day in western time zones.
