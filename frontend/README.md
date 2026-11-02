# Frontend: crime dashboard

A static web page that maps and charts crime in Los Angeles, San Diego and San Francisco, next to ZIP socioeconomic data. It is plain HTML, JavaScript and CSS with no build step, no Node and no server code. Any host that serves static files can serve it.

| File | What it is |
|---|---|
| `index.html` | Page layout: filter sidebar, map, monthly trend chart |
| `app.js` | Loads `data/`, applies the filters, draws the map and chart |
| `styles.css` | Page styles, including dark mode and the mobile filter drawer |
| `data/` | Small pre-aggregated files written by `crime-pipeline export` (committed to git) |
| `Dockerfile`, `Dockerfile.dockerignore` | nginx image that serves this folder (see [Deploying](#deploying)) |

The page reads only the files in `data/`. It loads [Leaflet](https://leafletjs.com/) 1.9.4 and [Plotly](https://plotly.com/javascript/) 3.1.0 from CDNs, and Esri map tiles, so viewing it needs an internet connection.

## Running it locally

Browsers block `fetch` from pages opened as files, so serve the folder:

```bash
cd frontend
python -m http.server 8000      # python3 on macOS if `python` isn't found
```

Then open <http://localhost:8000>.

## What the page shows

- **Filters:** city, crime group (Violent, Property, Vehicle, Society, Other, or all) and a month range. Any change redraws the map and the chart together.
- **San Diego and San Francisco:** a ZIP map. **Map shows** switches between the offense count and offenses per 1,000 residents. Colors use quantile classes, so each shade covers about the same number of ZIPs. Hover a ZIP to see its offenses and its population, median household income, median home value and poverty rate.
- **Los Angeles:** LAPD publishes locations by area only, so the map draws one circle per LAPD area at the area's center. The circle's area shows the offense count.
- **San Francisco districts:** dashed outlines show the current SFPD districts.
- **Monthly trend:** offenses per month for the selected city, group and months.

Things to know when reading it:

- Counts cover comparable offenses only: crimes (not non-crime reports), no likely duplicates, from the shared start date (`2025-01-01`). See the [data contract](../backend/DATA_CONTRACT.md#default-filters-for-honest-comparisons).
- Per-capita rates use each ZIP's most recent `Total_Population` in the socioeconomic data. ZIPs with no residents (for example, campuses and PO-box ZIPs) are shown in gray.
- The map only draws ZIPs whose polygon overlaps the city's box. The export tags each polygon with that city (`CITY_BOUNDS` in `backend/pipeline/crime_pipeline/export.py`). Some San Diego reports carry addresses far outside the city, and drawing them would skew the colors. Those offenses still count in the header total and the trend.
- The latest month is usually partial. The header shows the last date in the data.
- LA only includes offenses with a victim. Read the data contract's known limitations before comparing cities.

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

The page switches to its mobile layout below 800 px wide, with filters behind a **Filters** button, so it also works in a narrow embed.

### Docker

The image serves the folder with nginx on port 80. Build it from the repo root (Docker must be installed and running):

```bash
docker build -f frontend/Dockerfile -t crime-dashboard .
docker run --rm -p 8080:80 crime-dashboard     # then open http://localhost:8080
```

`Dockerfile.dockerignore` limits the build context to `frontend/`, so the multi-GB `backend/data/` folder isn't sent to Docker.
