# Patch notes: Static crime dashboard and deployment
Task TASK-001 · branch orch/task-001 · 2026-11-02

## For users
Adds city, crime group, and month filters that update the map and monthly trend.
Shows geographic postal areas shaded by counts or offenses per 1,000 residents.
Shows Los Angeles police areas as markers.
Documents hosting and embedding the dashboard in Google Sites.

## For developers
Adds aggregation and geographic compatibility reporting in `backend/pipeline/crime_pipeline/export.py`.
Registers export after database loading in `backend/pipeline/crime_pipeline/cli.py`.
Moves dashboard inputs into `backend/data/`.
Adds the static dashboard and committed data bundle under `frontend/`.
Adds nginx container delivery through `frontend/Dockerfile`.
Adds GitHub Pages deployment through `.github/workflows/pages.yml`.

## Checks
Four targeted tests pass.
In-memory checks confirm filtered aggregation totals.
JavaScript syntax validation passes.
Exported structured data parses successfully.
Both count files agree on city totals.
The bundle occupies 6.55 megabytes; postal polygons occupy 3.95 megabytes.
San Francisco coverage tests confirm every exported postal code maps.

## Known gaps
Docker socket permissions prevent image build and serving validation.
Browser rendering and interactions remain unverified in this review.
The full backend suite remains unverified under read-only filesystem restrictions.
