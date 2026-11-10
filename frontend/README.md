# Frontend: crime dashboard

A static web page that compares crime in Los Angeles, San Diego and San Francisco and maps it next to ZIP socioeconomic data. It is plain HTML, JavaScript and CSS with no build step, no Node and no server code. Any host that serves static files can serve it.

| File | What it is |
|---|---|
| `index.html` | Page layout: header, shared filter bar, tab bar and one panel per tab |
| `app.js` | Entry point: loads the data, wires the filter bar, theme toggle and tabs, and renders the active tab |
| `data.js` | Loads `data/` and builds lookups: city info, category groups, ZIP socioeconomic rows, LAPD area estimates, city populations, cities that record the time of day |
| `filters.js` | The shared filter bar and the `filters` state object every tab reads |
| `pills.js` | The single-choice pill buttons used by the filter bar and each tab's controls |
| `display.js` | City and crime-group colors for light and dark mode, number and date formats, shared Plotly drawing |
| `trends.js` | Trends tab |
| `compare.js` | Compare tab |
| `correlation.js` | Correlation tab (placeholder for now) |
| `map.js` | Map tab |
| `styles.css` | Page styles, including dark mode and the narrow layout |
| `data/` | Small pre-aggregated files written by `crime-pipeline export` (committed to git) |
| `Dockerfile`, `Dockerfile.dockerignore` | nginx image that serves this folder (see [Deploying](#deploying)) |

The JavaScript files are native ES modules (`<script type="module">`), so they need no bundler. The page reads only the files in `data/`. It loads [Leaflet](https://leafletjs.com/) 1.9.4 and [Plotly](https://plotly.com/javascript/) 3.1.0 from CDNs, and Esri map tiles, so viewing it needs an internet connection.

## Running it locally

Browsers block `fetch` from pages opened as files, so serve the folder:

```bash
cd frontend
python -m http.server 8000      # python3 on macOS if `python` isn't found
```

Then open <http://localhost:8000>.

## Running the tests

The tests live in `frontend-tests/`, outside this folder so they are never deployed. They load the real `index.html` and modules into [jsdom](https://github.com/jsdom/jsdom) and run on Node's built-in test runner. The page itself needs no Node. Only the tests do.

```bash
cd frontend-tests
npm install
npm test
```

They cover the pill buttons, the whole filter bar (groups, categories, date presets and typed dates, measure, cities and the Los Angeles note) and the Map's per-100,000 rate. They don't draw charts or the map, so check those in a browser. They were written and run on Node 26.

## What the page shows

### Filter bar

The bar at the top applies to every tab. A change redraws the tab you're on, and other tabs redraw when you open them.

- **Cities:** toggle Los Angeles, San Diego and San Francisco. All three start on, and at least one stays on. Each city keeps one color on every chart: LA blue, SD orange, SF aqua.
- **Measure:** offense count, or offenses per 100,000 residents. Rates divide each day's offenses by the city's Census population for that year (`data/city_population.json`). There is no 2026 estimate yet, so 2026 uses 2025.
- **Dates:** a preset pill (all data, last 12 months, last 90 days, each calendar year) or explicit **From** and **To** dates. Editing a date clears the preset pill, unless the dates match one.
- **Crime group and Category:** click a group pill (Violent, Property, Vehicle, Society, Other, or All). The category pills list every category, or only the selected group's. Picking a category selects its group.
- A yellow note appears when LA is selected with the Society or Other group. LA's data only includes offenses with a victim, so those numbers undercount.

The header shows the selection and its total offenses.

### Trends tab

Offenses over time, with the selected cities overlaid on one chart.

- **Layout:** cities overlaid, or one panel per city. The panels share one y-axis, so their heights compare directly.
- **Period:** day, week (Monday to Sunday) or month. Weeks and months that aren't fully inside the date range or a city's data are left out, so a partial last month doesn't look like a drop.
- **Rolling average:** none, 7-day or 28-day, for the Day period. Each point is the mean of that day and the days before it. The average looks back before the start date when the data allows.
- **Index to 100 at the start:** scales each city so its first period shown is 100. Use it to compare change rather than size.
- Hover shows every city's value for that period. Drag the handles of the bar under the chart to zoom into a stretch of time.

### Compare tab

Four panels that show how the selected cities differ. Hover any bar or point for its value.

- **Offenses by category:** one bar per city for each shared category, in the shared display order (Violent, Property, Vehicle, Society, Other). It follows every filter: cities, group or category, dates and measure. In count mode a bar is the total for the date range; in rate mode it is offenses per 100,000 residents over the range. Read it for the size of each kind of crime, city against city.
- **Crime mix:** one 100% bar per city, split into the five crime groups. Read it for what share of each city's crime falls in each group. It follows every filter, and shares are worked out within the selected offenses. With a group or category selected, each bar is all one group, so pick All groups to compare the mix. Shares are the same for counts and rates. Crime groups have their own colors, separate from the city colors. Segments under 5% carry no label; hover shows them.
- **Day of week:** one bar per city for each weekday. Each bar is the average for that weekday over the date range, so a range with more Mondays than Sundays still compares fairly. It follows every filter.
- **Hour of day:** one line per city across the 24 hours, as an average per day. Only LA and SF are shown: San Diego's data has no time of day, and the panel says so when SD is selected. The hourly file isn't split by date or category, so this panel covers every date from the shared start date and the whole selected crime group. It follows the cities, the group and the measure. Rates use each city's newest population estimate. LA's peaks at midnight and noon likely include reports with an unknown time.

LA's Society and Other numbers are flagged wherever they appear. Its striped bars and segments, and its dotted hour line when one of those groups is selected, mark numbers that undercount, because LA only records offenses with a victim.

### Correlation tab

Compares socioeconomic factors with reported crime. The tab and its panel are in place, but they show only a "coming soon" message so far.

### Map tab

One city at a time. **City** lists the toggled cities and starts on the first one. The map uses the shared crime group and date filters, rounded out to whole months, because the map files are monthly.

- **Map shows** switches between the offense count and offenses per 100,000 residents, for every city. Colors use quantile classes, so each shade covers about the same number of ZIPs or areas, and the legend lists each class's range.
- **San Diego and San Francisco:** a ZIP map. Hover a ZIP to see its offenses and its population, median household income, median home value and poverty rate. ZIP counts are kept by crime group only, so picking a category shows its whole group on the ZIP map.
- **Los Angeles:** LAPD publishes locations by area only, so the map shades LAPD's 21 areas. Area counts are kept by category, so the shading follows the category filter. Hover an area to see its bureau, offenses, rate and census values. The census values are labelled "Estimated from ZIPs". The export estimates them by overlaying the ZIP polygons on each area: a ZIP counts in proportion to the share of its area inside the LAPD area, as if its residents were spread evenly. Rates use the estimated area population. Downtown's Central area has few residents, so its rate is far above the others.
- **San Francisco districts:** dashed outlines show the current SFPD districts.

### Things to know on every tab

- Counts cover comparable offenses only: crimes (not non-crime reports), no likely duplicates, from the shared start date (`2025-01-01`). See the [data contract](../backend/DATA_CONTRACT.md#default-filters-for-honest-comparisons).
- Map rates use each ZIP's most recent `Total_Population` in the socioeconomic data, or each LAPD area's estimated population (`data/lapd_area_socioeconomic.json`). ZIPs with no residents (for example, campuses and PO-box ZIPs) are shown in gray.
- The map only draws ZIPs whose polygon overlaps the city's box. The export tags each polygon with that city (`CITY_BOUNDS` in `backend/pipeline/crime_pipeline/export.py`). Some San Diego reports carry addresses far outside the city, and drawing them would skew the colors. Those offenses still count in the header total and the trend.
- Each city's data ends on a different day, and the last few days fill in late. The Trends and category notes name the end date for any city that stops before the selected range does.
- LA only includes offenses with a victim. Read the data contract's known limitations before comparing cities.

## Sources

What the page and its `data/` files come from. Publishers, links and dates are in the root README's [data sources and citations](../README.md#data-sources-and-citations).

| Source | What the frontend uses it for |
|---|---|
| LAPD NIBRS Victims Dataset (data.lacity.org) | Los Angeles offense counts in every chart and the LA map |
| SDPD Police NIBRS crime offenses (data.sandiego.gov) | San Diego offense counts in every chart and the SD ZIP map |
| SFPD Incident Reports: 2018 to Present (DataSF) | San Francisco offense counts in every chart and the SF ZIP map |
| SFPD district boundaries, current (DataSF `d4vc-q76h`) | Dashed district outlines on the SF map (`data/sfpd_districts.geojson`) |
| Census TIGERweb 2020 ZIP Code Tabulation Areas | SF ZIP shapes missing from the statewide ZIP file, in `data/zip_codes.geojson` |
| Census Bureau Vintage 2025 city population estimates (`sub-est2025_6.csv`) | Per-100,000 rates on the Trends and Compare tabs (`data/city_population.json`) |
| LAPD Crime Data from 2020 to Present (data.lacity.org) | LAPD area center points in `data/lapd_areas.json`; the page doesn't read this file |
| City of Los Angeles LAPD map service, reporting districts | LAPD area shapes on the LA map (`data/lapd_divisions.geojson`) |
| `ca_zip_codes.geojson` (source to be confirmed) | ZIP shapes on the SD and SF maps, and the overlay behind the LA area estimates |
| `ca_socioeconomic_2018_present.csv` (source to be confirmed) | ZIP tooltips and rates on the SD and SF maps, and the LA area estimates |
| Leaflet 1.9.4 (unpkg CDN) | The Map tab |
| Plotly.js 3.1.0 (Plotly CDN) | Trends and Compare charts |
| Esri World Light Gray and World Dark Gray Canvas basemaps | Base map tiles for light and dark mode |

## Refreshing the data

The files in `data/` come from the backend database. After the database is rebuilt, regenerate and commit them from `backend/`:

```bash
crime-pipeline export     # or `crime-pipeline all` to rebuild everything first
git add ../frontend/data
```

`export` also writes `data/compatibility_report.md`. It shows how well each city's ZIPs and police divisions join to the socioeconomic data and map shapes. Every file in `data/` and its fields are described in [backend/DATA_CONTRACT.md](../backend/DATA_CONTRACT.md#web-export-frontenddata).

## Deploying

The site is this folder as-is: commit the page and `data/`, and any static host can serve it.

### GitHub Pages

`.github/workflows/pages.yml` publishes `frontend/` whenever a push to `main` changes something in `frontend/` (or the workflow itself). You can also run it by hand from the repo's **Actions** tab (**Deploy dashboard to GitHub Pages → Run workflow**).

One-time setup, by a repo admin:

1. Open the repo on GitHub → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the workflow). When it finishes, the site is at the URL shown on the Pages settings page and in the workflow run, for this repo <https://christianbyars.github.io/BDA594-Group-Project/>.

### Embedding in Google Sites

1. In the Google Sites editor, choose **Insert → Embed**.
2. On the **Embed code** tab, paste the following, using your Pages URL:

   ```html
   <iframe src="https://christianbyars.github.io/BDA594-Group-Project/"
           width="100%" height="1400" style="border: 0;" title="Crime dashboard"></iframe>
   ```

3. Click **Next → Insert**. If the page is cut off, drag the embed box's handles until the map and chart both fit.

Below 800 px wide each filter's label sits above its pills, the tabs stretch to the full width, and the Trends chart drops its line-end labels in favor of the legend, so the page also works in a narrow embed. Below 1100 px the Compare tab's day-of-week and hour-of-day panels stack instead of sitting side by side. The Compare tab is taller than the embed, so the embed scrolls.

### Docker

The image serves the folder with nginx on port 80. Build it from the repo root (Docker must be installed and running):

```bash
docker build -f frontend/Dockerfile -t crime-dashboard .
docker run --rm -p 8080:80 crime-dashboard     # then open http://localhost:8080
```

`Dockerfile.dockerignore` limits the build context to `frontend/`, so the multi-GB `backend/data/` folder isn't sent to Docker.
