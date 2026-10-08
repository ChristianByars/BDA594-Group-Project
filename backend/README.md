# Backend: crime data pipeline

Turns the raw crime exports from **Los Angeles**, **San Diego** and **San Francisco** into one standardized SQLite database, `data/crime.db`, for the website.

```
data/raw/ ──clean──▶ data/cleaned/ ──standardize──▶ data/standardized/ ──check──▶ ──load──▶ data/crime.db
```

| Step | Output |
|---|---|
| **clean** | Each city parsed, typed and de-junked, still in that city's own column names |
| **standardize** | All cities in one shared layout, plus shared crime categories, LAPD area details and SF police districts and ZIPs |
| **check** | About 85 quality checks against the raw data. `all` stops here if any check fails. |
| **load** | `crime.db` with indexes, summary tables and lookup tables |

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
crime-pipeline all      # clean → standardize → check → load (~2.5 minutes)
```

| Command | What it does |
|---|---|
| `crime-pipeline clean` | `data/raw/` → `data/cleaned/` |
| `crime-pipeline standardize` | `data/cleaned/` → `data/standardized/` |
| `crime-pipeline check` | Quality checks. Exits with code 1 if any fail. |
| `crime-pipeline load` | `data/standardized/` → `data/crime.db` |
| `crime-pipeline fetch-boundaries` | Re-downloads the SF boundary files. They're already in git, so only needed to refresh them. |

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

Edit the CSV, then run `crime-pipeline standardize check load`, or just `crime-pipeline all`. The checks warn about any new code or category that isn't mapped yet.

## SF police districts and ZIPs

These are worked out from each crime's coordinates using the boundary files in `data/boundaries/sf/`:

| File | Source |
|---|---|
| `sfpd_districts_2015_2026.geojson` | SFPD districts used until 2026-09-30 (DataSF `bj3n-hmgf`) |
| `sfpd_districts_current.geojson` | SFPD districts redrawn 2026-10-01 (DataSF `d4vc-q76h`) |
| `sf_zcta_2020.geojson` | 2020 Census ZIP Code Tabulation Areas (Census TIGERweb) |

Each SF crime is matched against the district map in effect on the date it occurred.

## Notebook

`notebooks/DataCleanUp.ipynb` is the original exploration that led to this pipeline, kept as a record. It changes into `backend/` on its own, so its `data/...` paths work. Its last cell runs the whole pipeline.

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
│  ├─ geo.py           SF district + ZIP matching; fetch-boundaries
│  ├─ lookups/         editable CSV mappings
│  ├─ checks.py        quality checks
│  ├─ schema.sql       crime.db tables
│  └─ load.py          builds crime.db
├─ tests/
├─ notebooks/
└─ data/               see data/README.md
```
