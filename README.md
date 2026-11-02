# BDA594-Group-Project

**Bad Data Analytics (BDA 594):** comparing reported crime across **Los Angeles**, **San Diego** and **San Francisco**, using each city's open crime data together with U.S. Census socioeconomic data.

## Repository layout

```
├─ backend/     data pipeline (Python) + datasets → builds backend/data/crime.db
│  ├─ pipeline/      cleaning and standardizing code
│  ├─ data/          raw/, cleaned/, standardized/ datasets (not in git)
│  ├─ notebooks/     original data exploration
│  └─ DATA_CONTRACT.md   what's in crime.db, for the website
├─ frontend/    static dashboard page (HTML, JavaScript, CSS) + data/ exported from crime.db
└─ docs/        project proposal and other write-ups
```

Open this folder (`BDA594-Group-Project/`) in VS Code. The shared `.vscode/settings.json` points Python and notebooks at `backend/.venv`.

## Quick start

1. **Build the database.** Follow [backend/README.md](backend/README.md):

   ```bash
   cd backend
   uv venv && uv pip install -e ".[dev,notebook]" && source .venv/bin/activate
   # put the raw city exports in backend/data/raw/ (see backend/data/README.md)
   crime-pipeline all
   ```

2. **View the site.** `crime-pipeline all` ends by exporting the website's data to `frontend/data/`. Serve the page with `cd frontend && python -m http.server 8000`. See [frontend/README.md](frontend/README.md).

## Data at a glance

| City | Source | Coverage | Location detail |
|---|---|---|---|
| Los Angeles | LAPD NIBRS Victims | Mar 2024 – present (full volume from Jan 2025) | 21 LAPD areas |
| San Diego | SDPD NIBRS offenses | 2020 – present | Coordinates, ZIP, 9 divisions |
| San Francisco | SFPD Incident Reports | 2018 – present | Coordinates, ZIP, 10 districts |

All three are mapped onto 17 shared crime categories in six groups: Violent, Property, Vehicle, Society, Other and Non-Crime. See [the data contract](backend/DATA_CONTRACT.md) for details and known limitations.

## Data sources and citations

Every external dataset and service the project uses. The folder READMEs list the subset each folder uses.

| Dataset or service | Publisher | Link | Date or vintage | What the project uses it for |
|---|---|---|---|---|
| LAPD NIBRS Victims Dataset | Los Angeles Police Department, via the City of Los Angeles open data portal | [data.lacity.org](https://data.lacity.org) | Mar 2024 – present; file `LAPD_NIBRS_Victims_Dataset.csv` in the database built 2026-10-08 | Los Angeles crimes: one row per victim, combined into offenses |
| Police NIBRS crime offenses | San Diego Police Department, via the City of San Diego open data portal | [data.sandiego.gov](https://data.sandiego.gov/datasets/police-nibrs/) | 2020 – present; yearly files `pd_nibrs_2020_datasd.csv` to `pd_nibrs_2026_datasd.csv` | San Diego crimes, with address ZIP, coordinates and police division |
| Police Department Incident Reports: 2018 to Present | San Francisco Police Department, via DataSF | [data.sf.gov](https://data.sf.gov/d/wg3w-h783) | 2018 – present; export of 2026-09-24 | San Francisco crimes, with coordinates for district and ZIP matching |
| SFPD police district boundaries, 2015 to 2026 | San Francisco Police Department, via DataSF | [bj3n-hmgf](https://data.sf.gov/d/bj3n-hmgf) | Districts in effect until 2026-09-30 | Assigns SF crimes before 2026-10-01 to a police district |
| SFPD police district boundaries, current | San Francisco Police Department, via DataSF | [d4vc-q76h](https://data.sf.gov/d/d4vc-q76h) | Districts in effect from 2026-10-01 | Assigns later SF crimes to a district; drawn as outlines on the SF map |
| ZIP Code Tabulation Areas (ZCTA) | U.S. Census Bureau, TIGERweb | [TIGERweb ZCTA layer](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/7) | 2020 Census | Assigns SF crimes to a ZIP from their coordinates; fills SF ZIPs missing from the statewide ZIP file |
| City and town population estimates (`sub-est2025_6.csv`) | U.S. Census Bureau, Population Estimates Program | [sub-est2025_6.csv](https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_6.csv) | Vintage 2025, July 1 of 2020–2025 | City populations for per-100,000 rates and the LAPD area population check |
| Crime Data from 2020 to Present | Los Angeles Police Department, via the City of Los Angeles open data portal | [data.lacity.org](https://data.lacity.org/d/2nrs-mtv8) | 2020–2024 crimes; frozen since LAPD's move to NIBRS | Center point of each LAPD area in `lapd_areas.csv` (mean of its crime locations) |
| LAPD bureau and area pages | Los Angeles Police Department | [lapdonline.org](https://www.lapdonline.org) | Access date not recorded | Checks which bureau each LAPD area belongs to in `lapd_areas.csv` |
| National Incident-Based Reporting System (NIBRS) offense definitions | Federal Bureau of Investigation, Uniform Crime Reporting Program | [FBI NIBRS](https://www.fbi.gov/how-we-can-help-you/more-fbi-services-and-information/ucr/nibrs) | Version not recorded | Offense codes, descriptions, categories and violent and property flags in `nibrs_offenses.csv` |
| LAPD reporting district boundaries (LAPD map service, layer 3) | City of Los Angeles, GIS | [maps.lacity.org](https://maps.lacity.org/lahub/rest/services/LAPD/MapServer/3) | Downloaded 2026-11-02 | Merged into the 21 LAPD area polygons for the LA map and the area census estimates |
| California ZIP code polygons (`ca_zip_codes.geojson`) | Source to be confirmed | Source to be confirmed | Not recorded | ZIP shapes for the SD and SF maps, and the ZIP overlay behind the LAPD area estimates |
| ZIP socioeconomic data, 2018–2024 (`ca_socioeconomic_2018_present.csv`) | Source to be confirmed | Source to be confirmed | 2018–2024 | Population, median household income, median home value and poverty by ZIP, for map tooltips, ZIP rates and the LAPD area estimates |

The last two files came in the original `CaliforniaData/` folder without a recorded source. They stay marked "source to be confirmed" until the team confirms where they came from.

### Tools and libraries

| Tool | Link | What the project uses it for |
|---|---|---|
| Leaflet 1.9.4 | [leafletjs.com](https://leafletjs.com/) | The Map tab, loaded from the unpkg CDN |
| Plotly.js 3.1.0 | [plotly.com/javascript](https://plotly.com/javascript/) | Trends and Compare charts, loaded from the Plotly CDN |
| Esri World Light Gray and World Dark Gray Canvas basemaps | [server.arcgisonline.com](https://server.arcgisonline.com/ArcGIS/rest/services/Canvas) | Base map tiles under the Map tab, for light and dark mode ("Tiles © Esri") |
| uv | [docs.astral.sh/uv](https://docs.astral.sh/uv/) | Creates the backend's Python environment and installs its packages |

The backend's Python packages (pandas, Shapely and certifi, plus pytest, Jupyter and Matplotlib for tests and notebooks) are listed in `backend/pyproject.toml`.

## Team

Matthew Tu (coordinator) · Christian Byars · Sam Jackowski · Renton McGregor

## License

[MIT](LICENSE)
