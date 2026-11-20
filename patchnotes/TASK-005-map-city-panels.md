# Patch notes: Map follows the filters, one panel per city
Task TASK-005 · branch map-city-panels · 2026-11-19

## For users
Fixes the Map tab ignoring the filter bar's Measure. The Map tab's own "City" and "Map shows" pills are removed, and the filter bar's Measure (offense count / per 100,000 residents) now shades the map, the same setting Trends and Compare use.
Shows one map panel per toggled city, side by side (stacked at 900px wide or less), instead of one city at a time.
Adds one shared legend above the panels, with one color scale computed across every visible panel, so a shade means the same number everywhere.
Lets picking a category narrow San Diego's and San Francisco's ZIP maps, not only Los Angeles's area map. The ZIP tooltip's offense count is that category's count.
Adds a note, shown only in count mode with two or more panels, that counts aren't comparable across panels because an LAPD area is a much bigger unit than a ZIP.
Each panel keeps its own zoom and pan; it refits to the city only when it first appears or when the number of visible panels changes.
Every tab now shows newer data (the data refresh below): offenses rise from 602,289 to 621,639 (+3.2%), and the data now runs to 2026-10-03 for LA, 2026-10-20 for SD and 2026-10-19 for SF (it ended 2026-09-19 to 09-23).

## For developers
Backend: `ZIP_MONTHLY` in `backend/pipeline/crime_pipeline/export.py` now groups by `crime_category`, so `zip_monthly.json` rows are `city, month, zip, category, count` (the `group` field is gone; look a group up in `crime_categories.json`). `backend/DATA_CONTRACT.md` and its change log are updated. File size 553 KB to 1.52 MB (18,398 rows).
Data refresh, in its own commit: the local `crime.db` (built 2026-10-22) was newer than the one behind the committed bundle (built 2026-10-08), so the whole `frontend/data/` bundle was regenerated with `crime-pipeline export`. Per-city totals in `zip_monthly.json` equal `daily_counts.json` (LA 348,184, SD 140,803, SF 132,652). Some earlier LA days moved by 1 because the source files were revised. The refresh also added 21 `socioeconomic.csv` rows for out-of-area ZIPs (90222, 90304, 92626) that now appear in SD's data.
Rewrites `frontend/map.js`: one Leaflet map per city code, created once by `ensurePanel` and hidden (not destroyed) when its city is untoggled, instead of one map reused for whichever city was selected. `setUpMap` is now empty; panels are created by the first `renderMap`.
Exports `quantileBreaks`, `zipCounts` and `legendHtml` from `map.js`, and `escapeHtml` from `frontend/display.js`, only so `frontend-tests/map.test.js` can call them directly.
`zipCounts(rows, city, months, matches)` now takes the rows and a category predicate as arguments instead of reading `data.zipMonthly` and `groupMatches` itself.
Removes `createPills`'s use in `map.js`, the `cityPills`/`measurePills` pill groups, `syncCityOptions`, and the single `map`/`areaLayer`/`districtLayer`/`legend`/`shownCity` globals and the Leaflet legend control. `filters.js` is unchanged.
Every tooltip string built from data (`PO_NAME`, `area_full_name`, `bureau`, ZIP) goes through `escapeHtml` before it reaches `bindTooltip`.
Updates `frontend/index.html`: removes `#mapPanel`'s `.panel-controls` block (`#mapCity`, `#mapMeasure`) and the dynamic `#mapTitle`; the `h2` is now the fixed text "Offenses by area"; adds `#mapLegend` and `#mapGrid`.
Updates `frontend/styles.css`: restyles `.map-legend` as a flat block in the page flow; adds `.map-grid` (columns from a `--cities` custom property, one column at 900px or less), `.map-city` (a subgrid over three shared rows, so the maps line up whatever the note length), `.map-city[hidden]` (needed: `display: grid` would otherwise override the `hidden` attribute), `.map-city-title`, `.map-city-note`, and `.legend-swatch.no-data`. Legend swatch colors use the per-item `--swatch` custom property instead of an inline `background`.
Rewrites the "Map tab" section of `frontend/README.md`.

## Checks
`cd backend && uv run pytest`: 39 passed (37 before, plus a test that two categories of one group in one ZIP and month give two rows, and a test that the committed `zip_monthly.json` rows are by known category).
`cd frontend-tests && npm test`: 94 passed, 0 failed (75 on main plus 19 new: `quantileBreaks`, `zipCounts`, `legendHtml`, `escapeHtml`, and the `index.html` map-panel shape). The new tests were written first and seen to fail. `node --check frontend/map.js` passes.
Mutation check: 16 changes to `map.js`, `display.js` and `index.html` (for example `zipCounts` ignoring the category, months or city; the legend losing its no-data row or title; `quantileBreaks` rounding up; `escapeHtml` skipping quotes) were each run on a scratch copy of `frontend/`. The first run left one alive (rounding up), so a test with a fractional class boundary was added; all 16 are now caught.
Browser check in Chrome (Playwright, local server): three panels of 461px at 1414px wide, two of 699px with LA off, one of 1414px with only SF; panels return in the order LA, SD, SF; maps share a top edge; stacked and no horizontal scroll at 800px; Per 100,000 residents changes every panel and the legend title; Burglary changes the shading, and SD ZIP 92101's tooltip reads 333, equal to the sum of its Burglary rows in `zip_monthly.json`; with every group it reads 24,168, equal to the JSON total; SF's zoom stayed after a filter change while LA's did not move; dark mode swapped the tiles on all three maps and the legend and headings restyled; no console errors.

## Known gaps
Not verified in a browser: Safari, Firefox and phones (same as TASK-004), and a window resize while the Map tab is hidden.
The per-city notes sit above each map, so on a screen under about 900px tall the maps start below the fold.
Offense counts across cities are still not comparable (LAPD areas are much larger than ZIPs); the note says so and points to the per-100,000 measure.
The data refresh changes every tab, not only the map; the previous bundle cannot be rebuilt because its `crime.db` is not in this checkout.
