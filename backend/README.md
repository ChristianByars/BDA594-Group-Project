# Backend: crime data pipeline

Turns the raw crime exports from **Los Angeles**, **San Diego** and **San Francisco** into one standardized SQLite database, `data/crime.db`, then exports a small data bundle for the website to `frontend/data/`.

```
data/raw/ ──clean──▶ data/cleaned/ ──standardize──▶ data/standardized/ ──check──▶ ──load──▶ data/crime.db ──export──▶ ../frontend/data/
```

| Step | Output |
|---|---|
| **clean** | Each city parsed, typed and de-junked, still in that city's own column names |
| **standardize** | All cities in one shared layout, plus shared crime categories, LAPD area details and SF police districts and ZIPs |
| **check** | About 85 quality checks against the raw data. `all` stops here if any check fails. |
| **load** | `crime.db` with indexes, summary tables and lookup tables |
| **export** | Monthly, daily and hour-of-day counts, city populations, lookups, ZIP socioeconomic rows and map shapes for the website, plus a report on how the crime data joins to the ZIP files |

- **Database reference for the website:** [DATA_CONTRACT.md](DATA_CONTRACT.md)
- **Data folders and where to get raw files:** [data/README.md](data/README.md)

## Setup

Run these from `backend/`. You need [uv](https://docs.astral.sh/uv/) and Python 3.11 or newer.

```bash
uv venv                               # creates backend/.venv
uv pip install -e ".[dev,notebook]"   # pipeline + pytest + Jupyter
source .venv/bin/activate
```

Then put the raw exports in `data/raw/` (see [data/README.md](data/README.md)).

## Running

```bash
crime-pipeline all      # clean → standardize → check → load → export (~2.5 minutes)
```

| Command | What it does |
|---|---|
| `crime-pipeline clean` | `data/raw/` → `data/cleaned/` |
| `crime-pipeline standardize` | `data/cleaned/` → `data/standardized/` |
| `crime-pipeline check` | Quality checks. Exits with code 1 if any fail. |
| `crime-pipeline load` | `data/standardized/` → `data/crime.db` |
| `crime-pipeline export` | `data/crime.db` → `../frontend/data/`. Exits with code 1 if a San Francisco ZIP or police district, or an LAPD area, has no polygon. |
| `crime-pipeline fetch-boundaries` | Re-downloads the SF boundary files and the LAPD division polygons. They're already in git, so only needed to refresh them. |

`clean` and `standardize` accept `--cities LA SD SF` to run only some cities. To use a different data folder, pass `--data-dir <folder>` or set `CRIME_DATA_DIR`.

## Changing a crime category mapping

The shared categories are plain CSV files in `pipeline/crime_pipeline/lookups/`:

| File | Maps |
|---|---|
| `crime_categories.csv` | The 17 shared categories and their group (Violent, Property, Vehicle, Society, Other, Non-Crime) |
| `nibrs_offenses.csv` | Each NIBRS code (LA and SD) → shared category |
| `sf_category_map.csv` | SFPD category + subcategory → shared category (`*` = any subcategory) |
| `la_local_codes.csv` | Old LAPD crime codes → shared category |
| `lapd_areas.csv` | LAPD area numbers, bureaus and map center points |
| `city_population.csv` | City population per year (used by `export` only, not a category mapping) |

Edit the CSV, then run `crime-pipeline standardize check load`, or just `crime-pipeline all`. The checks warn about any new code or category that isn't mapped yet.

## SF police districts and ZIPs

These are worked out from each crime's coordinates using the boundary files in `data/boundaries/sf/`:

| File | Source |
|---|---|
| `sfpd_districts_2015_2026.geojson` | SFPD districts used until 2026-09-30 (DataSF `bj3n-hmgf`) |
| `sfpd_districts_current.geojson` | SFPD districts redrawn 2026-10-01 (DataSF `d4vc-q76h`) |
| `sf_zcta_2020.geojson` | 2020 Census ZIP Code Tabulation Areas (Census TIGERweb) |

Each SF crime is matched against the district map in effect on the date it occurred.

## LAPD division polygons

LAPD reports each crime's area only, with no address or coordinates. For the website's LA map, `fetch-boundaries` downloads LAPD's reporting districts (about 1,135) from the City of Los Angeles LAPD map service and merges them by area number into `data/boundaries/la/lapd_divisions.geojson`. That file has 21 areas, named as in `lapd_areas.csv`. The service returns at most about 1,000 features per request, so the districts are fetched in pages.

## Website data bundle

`crime-pipeline export` writes small pre-aggregated files to `frontend/data/`, so the website never opens `crime.db`. Run it after `load`, then commit `frontend/data/` so the site deploys without a rebuild. The files and their fields are listed in [DATA_CONTRACT.md](DATA_CONTRACT.md#web-export-frontenddata). The whole folder is about 8.5 MB; keep it under 10 MB.

| Output | Contents |
|---|---|
| `zip_monthly.json`, `division_monthly.json` | Offenses per month by ZIP and crime group, and by police division and crime category |
| `daily_counts.json` | Offenses per city, day and crime category. Its city totals match `zip_monthly.json`. |
| `hourly_counts.json` | Offenses per city, hour of day and crime group, for LA and SF (SD has no time of day) |
| `city_population.json` | City population per year, 2020–2025, for per-100,000 rates |
| `crime_categories.json`, `lapd_areas.json`, `metadata.json` | Category order and descriptions, LAPD area points, build dates and each city's date range |
| `socioeconomic.csv`, `zip_codes.geojson`, `sfpd_districts.geojson` | ZIP socioeconomic rows and map shapes |
| `lapd_divisions.geojson`, `lapd_area_socioeconomic.json` | Simplified LAPD area shapes, and population, income, home value and poverty estimated per area from the ZIPs that overlap it |

It also writes `frontend/data/compatibility_report.md`. For each city it shows how many ZIPs and police divisions in the crime data match the socioeconomic CSV, the ZIP polygons and the division boundaries, and how many offenses have no usable geography. It names the San Diego ZIPs that have no polygon; those are PO boxes and out-of-area addresses, so they are reported but don't fail the step.

The LAPD area estimates weight each overlapping ZIP by the share of its area inside the LAPD area; [DATA_CONTRACT.md](DATA_CONTRACT.md#web-export-frontenddata) gives the method. `export` prints how the 21 estimated populations add up against the Census city population for the same year; expect them to be within about 10%.

| Input | Contents |
|---|---|
| `data/boundaries/ca/ca_zip_codes.geojson` | California ZIP code polygons (about 77 MB). Only the ZIPs found in the SD and SF data are exported. |
| `data/census/ca_socioeconomic_2018_present.csv` | Population, income, home value and poverty by ZIP and year, 2018 onward |
| `data/boundaries/sf/sf_zcta_2020.geojson` | Fills SF ZIPs missing from the statewide file (currently 94188) |
| `data/boundaries/sf/sfpd_districts_current.geojson` | Copied unchanged for the SF district layer |
| `data/boundaries/la/lapd_divisions.geojson` | LAPD area polygons, simplified for the LA map and overlaid on the ZIP polygons for the area estimates |
| `pipeline/crime_pipeline/lookups/city_population.csv` | City populations, 2020–2025, from the Census Bureau's Vintage 2025 city estimates (`sub-est2025_6.csv`, the file the per-capita notebook downloads). Update it when a new vintage is published. |

## Sources

Datasets and services the pipeline and notebooks read. Publishers, links and dates are in the root README's [data sources and citations](../README.md#data-sources-and-citations).

| Source | What the backend uses it for |
|---|---|
| LAPD NIBRS Victims Dataset (data.lacity.org) | Los Angeles crimes: one row per victim, combined into offenses |
| SDPD Police NIBRS crime offenses (data.sandiego.gov) | San Diego crimes, with address ZIP, coordinates and police division |
| SFPD Incident Reports: 2018 to Present (DataSF) | San Francisco crimes, with coordinates for district and ZIP matching |
| SFPD district boundaries, 2015 to 2026 and current (DataSF `bj3n-hmgf`, `d4vc-q76h`) | Assigns SF crimes to the district map in effect on their date; `fetch-boundaries` downloads them |
| Census TIGERweb 2020 ZIP Code Tabulation Areas (ZCTA) | Assigns SF crimes to a ZIP; fills SF ZIPs missing from the statewide ZIP file |
| Census Bureau Vintage 2025 city population estimates (`sub-est2025_6.csv`) | `city_population.csv` for per-100,000 rates and the LAPD area population check; `PerCapitaRates.ipynb` downloads it |
| LAPD Crime Data from 2020 to Present (data.lacity.org) | LAPD area center points in `lapd_areas.csv` |
| lapdonline.org | LAPD bureau assignments in `lapd_areas.csv` |
| FBI National Incident-Based Reporting System (NIBRS) offense definitions | Codes, descriptions, categories and flags in `nibrs_offenses.csv` |
| City of Los Angeles LAPD map service, reporting districts | The 21 LAPD area polygons; `fetch-boundaries` downloads and merges them |
| `ca_zip_codes.geojson` (source to be confirmed) | ZIP polygons for the web export and the LAPD area overlay |
| `ca_socioeconomic_2018_present.csv` (source to be confirmed) | ZIP socioeconomic rows for the web export and the LAPD area estimates |

## Notebook

`notebooks/DataCleanUp.ipynb` is the original exploration that led to this pipeline, kept as a record. It changes into `backend/` on its own, so its `data/...` paths work. Its last cell runs the whole pipeline.

`notebooks/PerCapitaRates.ipynb` compares the cities per 100,000 residents using Census city populations. It reads `crime.db` and downloads the population file into `data/raw/census/` on first run.

Editors usually don't list a nested `backend/.venv` as a kernel option. Register it once as a named kernel:

```bash
.venv/bin/python -m ipykernel install --user --name bda594-backend --display-name "BDA594 backend (.venv)"
```

Then in VS Code: **Select Kernel → Select Another Kernel… → Jupyter Kernel… → BDA594 backend (.venv)**.

## Tests

```bash
pytest
```

The tests use small made-up inputs, so they run in seconds without the data files.

## Layout

```
backend/
├─ pyproject.toml
├─ DATA_CONTRACT.md
├─ pipeline/crime_pipeline/
│  ├─ cli.py           crime-pipeline command
│  ├─ config.py        data folder and file locations
│  ├─ common.py        shared column layout and helpers
│  ├─ cities/          la.py, sd.py, sf.py: clean() and standardize() per city
│  ├─ standardize.py   runs clean / standardize for each city
│  ├─ enrich.py        shared categories, NIBRS details, LAPD areas, SF geography
│  ├─ geo.py           SF district + ZIP matching, LAPD division polygons; fetch-boundaries
│  ├─ lookups/         editable CSV mappings
│  ├─ checks.py        quality checks
│  ├─ schema.sql       crime.db tables
│  ├─ load.py          builds crime.db
│  └─ export.py        web data bundle and compatibility report
├─ tests/
├─ notebooks/
└─ data/               see data/README.md
```
