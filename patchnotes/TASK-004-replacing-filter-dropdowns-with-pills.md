# Patch notes: Pill filters and per-100,000 map rates
Task TASK-004 · branch frontend-pill-filters · 2026-11-02

## For users
Replaces the dropdowns for crime group, category, date presets and measure with clickable pill buttons.
Shows every category pill up front. Picking a group narrows the list, and picking a category selects its group.
Turns the Trends controls and the Map's city and measure choices into pills as well.
Shows Measure and Map shows as two-way switches.
Moves the Dates row between Cities and Crime group.
Clears the date preset pill when you edit the From or To date, unless the dates match a preset.
Changes Map rates from per 1,000 to per 100,000 residents, so they match the Trends and Compare tabs. The legend and tooltips say so.
Keeps a greyed-out selected pill grey when the pointer is over it.

## For developers
Adds `frontend/pills.js`, a `createPills` helper for single-choice pill groups that keeps keyboard focus when the options change.
Updates `frontend/filters.js`, `frontend/trends.js` and `frontend/map.js` to use it, and renames `perThousand` to `perHundredThousand` in `frontend/map.js`.
Rewrites the filter bar in `frontend/index.html` as four rows. No `<select>` elements remain.
Removes about 1,000 lines of CSS for elements that no longer exist, taking `frontend/styles.css` from 1,642 to 615 lines, and adds the pill, switch and filter bar rules with dark mode variants.
Updates `frontend/README.md` to describe the pills, per-100,000 map rates and the filter order.

## Checks
All eight frontend JavaScript modules pass a syntax check.
A computed-style comparison of the old and new stylesheets found no differences across 2,016 elements, in light and dark mode, on the Trends, Compare and Map tabs, at four screen sizes.
Group, category, date preset, measure and Trends control behavior was checked in a browser, including the disabled rolling average pills in light and dark mode.
The branch merges cleanly with `origin/main`.

## Known gaps
Only Chromium was tested. Safari, Firefox and phones remain unverified.
The frontend has no automated tests.
The stylesheet comparison skipped chart internals and the map itself. The legend rules were kept unchanged.
The backend is unchanged, so its tests were not rerun.
Each pill is its own keyboard tab stop, so the category row takes many presses to cross.
Map rates show one decimal place even at large values.
