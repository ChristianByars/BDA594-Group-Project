# backend/data

Datasets live here. Git keeps the folders, this README, the boundary files and the ZIP socioeconomic CSV, but **not the crime data**: raw exports are hundreds of MB and everything else is rebuilt by the pipeline.

| Folder | Contents | Made by |
|---|---|---|
| `raw/` | Original city exports, never modified | You (see below) |
| `boundaries/sf/` | SF police district + ZIP shapes (committed to git) | `crime-pipeline fetch-boundaries` |
| `boundaries/la/` | LAPD's 21 area polygons, `lapd_divisions.geojson` (committed to git), read by `crime-pipeline export` | `crime-pipeline fetch-boundaries` |
| `boundaries/ca/` | California ZIP code polygons, `ca_zip_codes.geojson` (committed to git), read by `crime-pipeline export` | Moved from the old `CaliforniaData/` folder |
| `census/` | ZIP socioeconomic data by year, `ca_socioeconomic_2018_present.csv` (committed to git), read by `crime-pipeline export` | Moved from the old `CaliforniaData/` folder |
| `cleaned/` | Each city parsed, typed and de-junked, in its own column names | `crime-pipeline clean` |
| `standardized/` | All cities in one shared layout, with categories and geography | `crime-pipeline standardize` |
| `crime.db` | SQLite database the web export reads | `crime-pipeline load` |
| `archive/` | Old notebook outputs, kept for reference; not used by the pipeline | — |

## Getting the raw data

Download the exports and save them with these names:

```
raw/
├─ la/LAPD_NIBRS_Victims_Dataset.csv
├─ sd/pd_nibrs_2020_datasd.csv … pd_nibrs_2026_datasd.csv
└─ sf/Police_Department_Incident_Reports__2018_to_Present_<date>.csv
```

| City | Dataset |
|---|---|
| Los Angeles | LAPD NIBRS Victims (data.lacity.org) |
| San Diego | SDPD NIBRS crime offenses, one file per year (data.sandiego.gov) |
| San Francisco | Police Department Incident Reports: 2018 to Present (data.sf.gov). If there are several files, the newest is used. |

Then run `crime-pipeline all` from `backend/`. Its last step, `export`, writes the website's data to `frontend/data/` (outside this folder).

## Sources

Files kept in this folder and where they come from. Publishers, links and dates are in the root README's [data sources and citations](../../README.md#data-sources-and-citations).

| File or folder | Source | What it's used for |
|---|---|---|
| `raw/la/` | LAPD NIBRS Victims Dataset (data.lacity.org) | Los Angeles crimes |
| `raw/sd/` | SDPD Police NIBRS crime offenses (data.sandiego.gov) | San Diego crimes |
| `raw/sf/` | SFPD Incident Reports: 2018 to Present (DataSF) | San Francisco crimes |
| `boundaries/sf/sfpd_districts_*.geojson` | SFPD district boundaries, 2015 to 2026 and current (DataSF `bj3n-hmgf`, `d4vc-q76h`) | Assigns SF crimes to a police district |
| `boundaries/sf/sf_zcta_2020.geojson` | Census TIGERweb 2020 ZIP Code Tabulation Areas | Assigns SF crimes to a ZIP |
| `boundaries/la/lapd_divisions.geojson` | City of Los Angeles LAPD map service, reporting districts merged into 21 areas | LA map shapes and the LAPD area census estimates |
| `boundaries/ca/ca_zip_codes.geojson` | Source to be confirmed | ZIP shapes for the website and the LAPD area overlay |
| `census/ca_socioeconomic_2018_present.csv` | Source to be confirmed | ZIP population, income, home value and poverty for the website and the LAPD area estimates |
