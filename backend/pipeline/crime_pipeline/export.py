"""Write the website's data bundle from crime.db and check how it joins to the ZIP data.

`crime-pipeline export` reads crime.db, the ZIP files and the SF boundary files in the
data folder, and writes small pre-aggregated files to Paths.export_dir (frontend/data/):

    zip_monthly.json          offenses per city, month, ZIP and crime group
    division_monthly.json     offenses per city, month, police division and crime category
    daily_counts.json         offenses per city, day and crime category
    hourly_counts.json        offenses per city, hour of day and crime group (LA and SF; SD has no time)
    city_population.json      city population per year, from lookups/city_population.csv
    crime_categories.json     shared categories with group, display order and description
    lapd_areas.json           LAPD areas with map center points
    metadata.json             build dates, shared window, each city's date range and map box
    socioeconomic.csv         rows of the ZIP socioeconomic CSV for ZIPs in the SD or SF data
    zip_codes.geojson         statewide ZIP polygons for ZIPs in the SD or SF data, each tagged
                              with the city whose map box it overlaps (properties.city)
    sfpd_districts.geojson    current SFPD districts, copied unchanged
    compatibility_report.md   how the crime data's ZIPs and divisions join to the files above

Counts cover comparable offenses only: the three default filters in DATA_CONTRACT.md.
Cities are written as codes (LA, SD, SF). A null zip or division marks offenses
without that geography; they are kept so each count file adds up to the city total.
The hourly file is the exception: offenses without a time are left out.
"""

import json
import shutil
import sqlite3
from datetime import datetime, timezone

import pandas as pd
import shapely

from crime_pipeline import geo, lookups
from crime_pipeline.common import CITY_INFO, READ_AS_TEXT

SOCIOECONOMIC_FILE = "ca_socioeconomic_2018_present.csv"
CURRENT_SF_DISTRICTS = geo.SF_DISTRICT_MAPS[-1][0]  # the map with no end date

CITY_CODES = {name: code for code, (name, *_) in CITY_INFO.items()}

# [[south, west], [north, east]] around each city: the area the website's map shows.
# ZIP polygons overlapping a city's box are drawn on its map; the rest are out-of-area addresses.
CITY_BOUNDS = {
    "LA": [[33.70, -118.67], [34.34, -118.15]],
    "SD": [[32.53, -117.29], [33.12, -116.90]],
    "SF": [[37.70, -122.52], [37.84, -122.35]],
}

# SF ZIPs and districts were assigned from polygons, so every one must have a polygon.
# Unmatched SD ZIPs are PO boxes and out-of-area addresses, so they are only reported.
STRICT_CITY = "SF"

DEFAULT_FILTERS = """
    is_crime = 1 AND possible_duplicate = 0
    AND occurred_date >= (SELECT value FROM metadata WHERE key = 'shared_window_start')
"""

# daily_counts has no zip column, so ZIP counts come from offenses with the same filters.
ZIP_MONTHLY = f"""
SELECT city, substr(occurred_date, 1, 7) AS month, zip, crime_group AS "group", COUNT(*) AS count
FROM offenses
WHERE {DEFAULT_FILTERS}
GROUP BY city, month, zip, crime_group
ORDER BY city, month, zip, crime_group
"""

DIVISION_MONTHLY = f"""
SELECT city, substr(occurred_date, 1, 7) AS month, police_division AS division,
       crime_category AS category, SUM(offense_count) AS count
FROM daily_counts
WHERE {DEFAULT_FILTERS}
GROUP BY city, month, police_division, crime_category
ORDER BY city, month, police_division, crime_category
"""

DAILY_COUNTS = f"""
SELECT city, occurred_date AS date, crime_category AS category, SUM(offense_count) AS count
FROM daily_counts
WHERE {DEFAULT_FILTERS}
GROUP BY city, occurred_date, crime_category
ORDER BY city, occurred_date, crime_category
"""

# Times are 'HH:MM'; rows without a time (all of SD) are left out.
HOURLY_COUNTS = f"""
SELECT city, CAST(substr(occurred_time, 1, 2) AS INTEGER) AS hour, crime_group AS "group", COUNT(*) AS count
FROM offenses
WHERE {DEFAULT_FILTERS} AND occurred_time IS NOT NULL
GROUP BY city, hour, crime_group
ORDER BY city, hour, crime_group
"""

DATE_RANGES = f"""
SELECT city, city AS name, MIN(occurred_date) AS first_date, MAX(occurred_date) AS last_date
FROM daily_counts
WHERE {DEFAULT_FILTERS}
GROUP BY city
ORDER BY city
"""

CATEGORIES = """
SELECT crime_category AS category, crime_group AS "group", sort_order AS "order", description
FROM crime_categories
ORDER BY sort_order
"""

LAPD_AREAS = """
SELECT area_number AS number, area_name AS name, area_full_name AS full_name, bureau,
       center_latitude AS lat, center_longitude AS lon
FROM lapd_areas
ORDER BY area_number
"""

# Offenses per city, ZIP and division: the input to the compatibility check.
GEOGRAPHY = f"""
SELECT city, zip, police_division AS division, COUNT(*) AS count
FROM offenses
WHERE {DEFAULT_FILTERS}
GROUP BY city, zip, police_division
"""


def query(db, sql):
    """Rows as dicts keyed by column name, with the city column turned into city codes."""
    cursor = db.execute(sql)
    keys = [column[0] for column in cursor.description]
    rows = [dict(zip(keys, values)) for values in cursor]
    for row in rows:
        if "city" in row:
            row["city"] = CITY_CODES[row["city"]]
    return rows


def write_json(path, data):
    path.write_text(json.dumps(data, separators=(",", ":")))


def city_populations():
    """Rows of {city code, year, population} from lookups/city_population.csv, as integers."""
    table = lookups.read("city_population")
    return [{"city": CITY_CODES[row.city], "year": int(row.year), "population": int(row.population)}
            for row in table.itertuples(index=False)]


def clip_zip_polygons(statewide, zips):
    """FeatureCollection of the statewide features whose ZIP_CODE is in zips."""
    features = [feature for feature in statewide["features"] if feature["properties"]["ZIP_CODE"] in zips]
    return {"type": "FeatureCollection", "features": features}


def tag_map_city(features):
    """Copies of the features with properties.city set to the city whose box each overlaps, or None."""
    boxes = {code: shapely.box(west, south, east, north)
             for code, [[south, west], [north, east]] in CITY_BOUNDS.items()}
    tagged = []
    for feature in features:
        polygon = shapely.geometry.shape(feature["geometry"])
        city = next((code for code, box in boxes.items() if polygon.intersects(box)), None)
        tagged.append({**feature, "properties": {**feature["properties"], "city": city}})
    return tagged


def zcta_polygons(zcta, zips):
    """Census ZCTA features for zips, labelled with ZIP_CODE like the statewide file."""
    return [{"type": "Feature", "properties": {"ZIP_CODE": feature["properties"]["ZCTA5"]},
             "geometry": feature["geometry"]}
            for feature in zcta["features"] if feature["properties"]["ZCTA5"] in zips]


def coverage_row(label, counts, known):
    """Markdown table row: how many keys of `counts`, and how many of their offenses, are in `known`."""
    matched = counts[counts.index.isin(known)]
    total = counts.sum()
    share = f" ({matched.sum() / total:.2%})" if total else ""
    return f"| {label} | {len(counts)} | {len(matched)} | {matched.sum():,} of {total:,}{share} |"


def listed(counts, keys):
    return ", ".join(f"{key} ({counts[key]:,})" for key in keys)


def check_compatibility(geography, socio_zips, polygon_zips, division_boundaries):
    """Compare the crime data's ZIPs and police divisions with the files the website joins them to.

    geography: rows of {city, zip, division, count} for the comparable offenses
    socio_zips: ZIPs with a row in the socioeconomic CSV
    polygon_zips: ZIPs with a polygon in the exported ZIP GeoJSON
    division_boundaries: {city code: division names with a polygon or map point};
        a city left out has no division boundary file

    Returns (Markdown report sections, failures). Failures name the San Francisco
    ZIPs and districts that have no polygon.
    """
    frame = pd.DataFrame(geography, columns=["city", "zip", "division", "count"])
    sections, failures = [], []
    for code, (name, *_) in CITY_INFO.items():
        rows = frame[frame["city"] == code]
        zip_counts = rows.groupby("zip")["count"].sum()
        division_counts = rows.groupby("division")["count"].sum()
        boundaries = division_boundaries.get(code)

        without_socio = sorted(set(zip_counts.index) - socio_zips)
        without_polygon = sorted(set(zip_counts.index) - polygon_zips)
        without_boundary = sorted(set(division_counts.index) - boundaries) if boundaries is not None else []

        no_zip = rows.loc[rows["zip"].isna(), "count"].sum()
        no_division = rows.loc[rows["division"].isna(), "count"].sum()
        no_geography = rows.loc[rows["zip"].isna() & rows["division"].isna(), "count"].sum()

        lines = [f"## {name}", "", "| Join | In crime data | Matched | Offenses matched |", "|---|---|---|---|"]
        if not zip_counts.empty:
            lines.append(coverage_row("ZIP → socioeconomic CSV", zip_counts, socio_zips))
            lines.append(coverage_row("ZIP → ZIP polygon", zip_counts, polygon_zips))
        if boundaries is None:
            lines.append(f"| Police division → boundary | {len(division_counts)} | no boundary file | |")
        else:
            lines.append(coverage_row("Police division → boundary", division_counts, boundaries))
        lines += ["", f"Offenses with no usable geography: {no_zip:,} without a ZIP, {no_division:,} without "
                      f"a division, {no_geography:,} with neither, out of {rows['count'].sum():,}."]
        if zip_counts.empty:
            lines += ["", "No ZIPs in the crime data, so the map uses police divisions."]
        if without_polygon:
            lines += ["", f"ZIPs without a polygon ({len(without_polygon)}): {listed(zip_counts, without_polygon)}"]
        if without_socio:
            lines += ["", f"ZIPs without a socioeconomic row ({len(without_socio)}): "
                          f"{listed(zip_counts, without_socio)}"]
        if without_boundary:
            lines += ["", f"Divisions without a boundary: {listed(division_counts, without_boundary)}"]
        sections.append("\n".join(lines))

        if code == STRICT_CITY:
            failures += [f"{name} ZIP {zip_code} has no polygon" for zip_code in without_polygon]
            failures += [f"{name} police district {division} has no polygon" for division in without_boundary]
    return "\n\n".join(sections), failures


def run(paths):
    """Write the web data bundle and compatibility report to paths.export_dir.

    Returns the compatibility failures; an empty list means every SF ZIP and
    district in the data has a polygon. Raises FileNotFoundError if crime.db or
    an input file is missing.
    """
    if not paths.database.exists():
        raise FileNotFoundError(f"{paths.database} is missing. Run `crime-pipeline load` first.")
    out = paths.export_dir
    out.mkdir(parents=True, exist_ok=True)

    db = sqlite3.connect(f"{paths.database.as_uri()}?mode=ro", uri=True)
    try:
        metadata = dict(db.execute("SELECT key, value FROM metadata"))
        geography = query(db, GEOGRAPHY)
        lapd_areas = query(db, LAPD_AREAS)
        date_ranges = query(db, DATE_RANGES)
        write_json(out / "zip_monthly.json", query(db, ZIP_MONTHLY))
        write_json(out / "division_monthly.json", query(db, DIVISION_MONTHLY))
        write_json(out / "daily_counts.json", query(db, DAILY_COUNTS))
        write_json(out / "hourly_counts.json", query(db, HOURLY_COUNTS))
        write_json(out / "crime_categories.json", query(db, CATEGORIES))
    finally:
        db.close()

    exported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    write_json(out / "city_population.json", city_populations())
    write_json(out / "lapd_areas.json", lapd_areas)
    write_json(out / "metadata.json", {
        "exported_at": exported_at,
        "database_built_at": metadata["built_at"],
        "pipeline_version": metadata["pipeline_version"],
        "shared_window_start": metadata["shared_window_start"],
        "cities": [{**city, "bounds": CITY_BOUNDS[city["city"]]} for city in date_ranges],
    })

    data_zips = {row["zip"] for row in geography if row["zip"]}
    socio = pd.read_csv(paths.census_dir / SOCIOECONOMIC_FILE, **READ_AS_TEXT)
    socio[socio["Zip_Code"].isin(data_zips)].to_csv(out / "socioeconomic.csv", index=False)

    # SF ZIPs come from Census ZCTA polygons; fill any the statewide file lacks from those.
    zip_polygons = clip_zip_polygons(json.loads(paths.ca_zip_boundaries.read_text()), data_zips)
    statewide_zips = {feature["properties"]["ZIP_CODE"] for feature in zip_polygons["features"]}
    sf_zips = {row["zip"] for row in geography if row["city"] == "SF" and row["zip"]}
    zcta = json.loads((geo.sf_boundary_dir(paths) / geo.SF_ZCTA_FILE).read_text())
    filled = zcta_polygons(zcta, sf_zips - statewide_zips)
    zip_polygons["features"] = tag_map_city(zip_polygons["features"] + filled)
    write_json(out / "zip_codes.geojson", zip_polygons)

    districts_file = geo.sf_boundary_dir(paths) / CURRENT_SF_DISTRICTS
    shutil.copyfile(districts_file, out / "sfpd_districts.geojson")
    districts = json.loads(districts_file.read_text())["features"]

    division_boundaries = {
        "LA": {area["name"] for area in lapd_areas},
        "SF": {feature["properties"]["district"].title() for feature in districts},
    }
    polygon_zips = statewide_zips | {feature["properties"]["ZIP_CODE"] for feature in filled}
    sections, failures = check_compatibility(geography, set(socio["Zip_Code"]), polygon_zips, division_boundaries)

    filled_note = ", ".join(sorted(feature["properties"]["ZIP_CODE"] for feature in filled)) or "none"
    result = "\n".join(f"- {failure}" for failure in failures) or "OK: every SF ZIP and district has a polygon."
    report = [
        "# Data compatibility report",
        f"Written by `crime-pipeline export` at {exported_at} from crime.db built at {metadata['built_at']}. "
        f"Counts are comparable offenses: is_crime = 1, possible_duplicate = 0, "
        f"occurred_date >= {metadata['shared_window_start']}.",
        f"SF ZIPs missing from the statewide ZIP file, filled from the Census ZCTA file: {filled_note}.",
        f"## Result\n\n{result}",
        sections,
    ]
    (out / "compatibility_report.md").write_text("\n\n".join(report) + "\n")

    files = sorted(path for path in out.iterdir() if path.is_file())
    for path in files:
        print(f"{path.name:<26} {path.stat().st_size / 1e6:6.2f} MB")
    print(f"{'Total':<26} {sum(path.stat().st_size for path in files) / 1e6:6.2f} MB in {out}")
    for failure in failures:
        print(f"FAILED: {failure}")
    return failures
