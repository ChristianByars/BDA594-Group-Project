# Patch notes: Los Angeles area maps and source citations
Task TASK-003 · branch orch/task-003 · 2026-11-02

## For users
Adds shaded Los Angeles Police Department areas with offense counts and rates per 1,000 estimated residents.
Shows estimated population, income, home value, and poverty in area tooltips.
Preserves category filtering and explains the estimation method.
Adds dataset citations and identifies sources awaiting confirmation.

## For developers
Extends backend/pipeline/crime_pipeline/geo.py with paged boundary downloads and division dissolving.
Extends backend/pipeline/crime_pipeline/export.py with area estimates, simplified polygons, and compatibility failures.
Updates frontend/data.js to load division polygons and estimates.
Updates frontend/map.js to share choropleth rendering across cities.
Documents exported fields and source usage throughout the project.

## Checks
Passes 32 backend tests.
Confirms 21 named areas and valid backend and frontend geometries.
Regenerates all committed area estimates successfully in memory.
Confirms positive populations totaling 3,669,470, within 5.2% of the corresponding Census estimate.
Confirms the frontend data bundle totals 8.54 megabytes.
Confirms the compatibility report matches all 21 areas.

## Known gaps
Five test setups require writable temporary storage.
Browser rendering remains unverified.
Two original data files retain unconfirmed sources.
