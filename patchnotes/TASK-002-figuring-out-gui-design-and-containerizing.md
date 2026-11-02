# Patch notes: Three-city comparison dashboard
Task TASK-002 · branch orch/task-002 · 2026-11-02

## For users
Adds shared city, crime, date and measure filters above three dashboard tabs.
Adds Trends controls for periods, rolling averages, indexing and city panels.
Adds category, crime-mix, weekday and hourly comparisons.
Keeps geographic exploration in the Map tab.
Adds population-based rates and explains data limitations.

## For developers
Extends `backend/pipeline/crime_pipeline/export.py` with daily counts, hourly counts and city populations.
Adds the committed population lookup in `backend/pipeline/crime_pipeline/lookups/city_population.csv`.
Splits `frontend/app.js` into native JavaScript modules without a build step.
Previously, crime-mix calculations ignored shared crime filters; `frontend/compare.js` now applies them before calculating shares.
Updates `frontend/README.md` to describe filtered shares and dashboard behavior.

## Checks
Four focused backend checks pass using in-memory inputs and committed files.
Direct chart checks pass for crime-mix filters, percentages and finite comparison values.
Trends checks pass for periods, layouts, rolling averages and indexing.
All 18 population values match the notebook's saved output.
The committed data bundle totals 8,471,212 bytes, below the 10-megabyte limit.

## Known gaps
Browser rendering, responsive layouts, external libraries and map tiles remain unverified.
The complete backend test suite remains unverified under read-only filesystem restrictions.
