## Summary

<!-- What changes and why, in two or three sentences. -->

## Changes

-

## Review findings addressed

<!-- IDs from the October 2026 code review, e.g. OPS-01, API-03. Write "None" if not applicable. -->

## Behaviour change

<!-- Breaking API, response, schema or config changes, and what callers must do. Write "None" if there are none. -->

## Testing

- [ ] `poetry run ruff check src tests` and `poetry run ruff format --check src tests`
- [ ] `poetry run pytest -q` (unit)
- [ ] `./precommit_tests.sh` (unit + integration against PostGIS), required when touching SQL, storage, wiring or API behaviour
- [ ] Other (describe below)

<!-- Paste the key result lines, e.g. "52 passed". Say which checks were not run and why. -->

## Notes

- [ ] `AGENTS.md` / `README.md` updated if commands, layout or conventions changed
