"""Write the website's data bundle from crime.db and check how it joins to the ZIP data.

`crime-pipeline export` reads crime.db, the ZIP files and the SF and LA boundary files in
the data folder, and writes small pre-aggregated files to Paths.export_dir (frontend/data/):

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
    lapd_divisions.geojson    LAPD's 21 areas, simplified for the web
    lapd_area_socioeconomic.json  census estimates per LAPD area, from the ZIPs that overlap it
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

import numpy as np
import pandas as pd
import shapely

from crime_pipeline import geo, lookups
from crime_pipeline.common import CITY_INFO, READ_AS_TEXT

SOCIOECONOMIC_FILE = "ca_socioeconomic_2018_present.csv"
CURRENT_SF_DISTRICTS = geo.SF_DISTRICT_MAPS[-1][0]  # the map with no end date

# Degrees (about 10 m). Each area is simplified separately, so neighbors can show gaps up to
# this size: under a pixel at neighborhood zoom. The web file stays under 0.1 MB.
LA_SIMPLIFY_TOLERANCE = 0.0001
COORDINATE_DECIMALS = 5  # about 1 m

SOCIOECONOMIC_VALUES = ["Total_Population", "Median_Household_Income", "Median_Home_Value", "Below_Poverty_Level"]

CITY_CODES = {name: code for code, (name, *_) in CITY_INFO.items()}

# [[south, west], [north, east]] around each city: the area the website's map shows.
# ZIP polygons overlapping a city's box are drawn on its map; the rest are out-of-area addresses.
CITY_BOUNDS = {
    "LA": [[33.70, -118.67], [34.34, -118.15]],
    "SD": [[32.53, -117.29], [33.12, -116.90]],
    "SF": [[37.70, -122.52], [37.84, -122.35]],
}

# SF ZIPs and districts were assigned from polygons, and LA is mapped by area polygons, so
# every ZIP and division of these cities must have a polygon. The value names a division.
# Unmatched SD ZIPs are PO boxes and out-of-area addresses, so they are only reported.
STRICT_CITIES = {"LA": "area", "SF": "police district"}

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


def simplify_features(features, tolerance):
    """Copies of the features with geometry simplified to tolerance (degrees) and coordinates rounded."""
    simplified = []
    for feature in features:
        polygon = shapely.geometry.shape(feature["geometry"]).simplify(tolerance)
        rounded = shapely.transform(polygon, lambda coordinates: coordinates.round(COORDINATE_DECIMALS))
        simplified.append({**feature, "geometry": shapely.geometry.mapping(rounded)})
    return simplified


def latest_socioeconomic(socio):
    """The most recent row per ZIP of the socioeconomic table, indexed by Zip_Code, as numbers.

    Negative values are the Census placeholders for unavailable estimates and become missing.
    """
    numbers = socio[["Zip_Code"]].copy()
    numbers["Year"] = socio["Year"].astype(int)
    for column in SOCIOECONOMIC_VALUES:
        values = pd.to_numeric(socio[column], errors="coerce")
        numbers[column] = values.where(values >= 0)
    return numbers.sort_values("Year").groupby("Zip_Code").tail(1).set_index("Zip_Code")


def weighted_mean(values, weights):
    """Mean of values weighted by weights, skipping missing values; None when no weight remains."""
    has_value = values.notna()
    total_weight = weights[has_value].sum()
    if not total_weight:
        return None
    return round(float((values[has_value] * weights[has_value]).sum() / total_weight))


def rounded_sum(values):
    """Sum of the values that aren't missing, rounded; None when every value is missing."""
    total = values.sum(min_count=1)
    return None if pd.isna(total) else round(float(total))


def area_estimate(contributions):
    """Census estimates for one area from the ZIP rows that overlap it.

    contributions: latest_socioeconomic rows with a `share` column, the fraction of each ZIP's area
    inside the area. Counts are summed in proportion to the share over the ZIPs that have them, and
    are None when no ZIP does. The poverty rate uses only ZIPs with both counts. Medians are averaged
    weighted by the population each ZIP contributes.
    """
    population = contributions["Total_Population"] * contributions["share"]
    below_poverty = contributions["Below_Poverty_Level"] * contributions["share"]
    has_both = population.notna() & below_poverty.notna()
    rate_population = float(population[has_both].sum())
    rate_below_poverty = float(below_poverty[has_both].sum())
    return {
        "year": int(contributions["Year"].max()) if len(contributions) else None,
        "population": rounded_sum(population),
        "below_poverty": rounded_sum(below_poverty),
        "poverty_rate": round(100 * rate_below_poverty / rate_population, 1) if rate_population else None,
        "median_household_income": weighted_mean(contributions["Median_Household_Income"], population),
        "median_home_value": weighted_mean(contributions["Median_Home_Value"], population),
    }


def area_socioeconomic(divisions, zip_features, socio):
    """Census estimates per LAPD area, by area-weighted overlay of the ZIP polygons.

    divisions: LAPD division features with properties area_number and area_name
    zip_features: ZIP polygon features keyed by properties.ZIP_CODE
    socio: the socioeconomic table as read from the CSV; each ZIP's latest year is used

    A ZIP's share in an area is the fraction of the ZIP's area inside it. Returns one dict
    per division with area_number, area_name and the fields of area_estimate: year (the
    latest census year used), population, below_poverty, poverty_rate (percent),
    median_household_income and median_home_value. A value is None when no overlapping
    ZIP has it.
    """
    latest = latest_socioeconomic(socio)
    zips = [feature for feature in zip_features if feature["properties"]["ZIP_CODE"] in latest.index]
    zip_codes = [feature["properties"]["ZIP_CODE"] for feature in zips]
    zip_polygons = shapely.make_valid(np.array([shapely.geometry.shape(feature["geometry"]) for feature in zips]))
    zip_areas = shapely.area(zip_polygons)
    tree = shapely.STRtree(zip_polygons)

    estimates = []
    for division in divisions:
        polygon = shapely.geometry.shape(division["geometry"])
        overlapping = [i for i in tree.query(polygon, predicate="intersects") if zip_areas[i] > 0]
        shares = shapely.area(shapely.intersection(zip_polygons[overlapping], polygon)) / zip_areas[overlapping]
        contributions = latest.loc[[zip_codes[i] for i in overlapping]].assign(share=shares)
        properties = division["properties"]
        estimates.append({"area_number": properties["area_number"], "area_name": properties["area_name"],
                          **area_estimate(contributions)})
    return estimates


def population_comparison(estimates, populations):
    """One line comparing the summed LA area estimates with the Census city population of the closest year."""
    year = max(estimate["year"] for estimate in estimates if estimate["year"])
    la_rows = [row for row in populations if row["city"] == "LA"]
    census = min(la_rows, key=lambda row: abs(row["year"] - year))
    estimated = sum(estimate["population"] or 0 for estimate in estimates)
    difference = estimated / census["population"] - 1
    return (f"LAPD area population estimates from {year} ZIP data add up to {estimated:,}; "
            f"the Census city estimate for {census['year']} is {census['population']:,} ({difference:+.1%}).")


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
    division_boundaries: {city code: division names with a polygon};
        a city left out has no division boundary file

    Returns (Markdown report sections, failures). Failures name the San Francisco ZIPs
    and districts, and the Los Angeles areas, that have no polygon.
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

        if code in STRICT_CITIES:
            failures += [f"{name} ZIP {zip_code} has no polygon" for zip_code in without_polygon]
            failures += [f"{name} {STRICT_CITIES[code]} {division} has no polygon" for division in without_boundary]
    return "\n\n".join(sections), failures


def run(paths):
    """Write the web data bundle and compatibility report to paths.export_dir.

    Returns the compatibility failures; an empty list means every SF ZIP and district
    and every LAPD area in the data has a polygon, and every LAPD area has a positive
    estimated population. Prints the file sizes and how the summed LAPD area population
    estimates compare with the Census city population. Raises FileNotFoundError if
    crime.db or an input file is missing.
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
    statewide = json.loads(paths.ca_zip_boundaries.read_text())
    zip_polygons = clip_zip_polygons(statewide, data_zips)
    statewide_zips = {feature["properties"]["ZIP_CODE"] for feature in zip_polygons["features"]}
    sf_zips = {row["zip"] for row in geography if row["city"] == "SF" and row["zip"]}
    zcta = json.loads((geo.sf_boundary_dir(paths) / geo.SF_ZCTA_FILE).read_text())
    filled = zcta_polygons(zcta, sf_zips - statewide_zips)
    zip_polygons["features"] = tag_map_city(zip_polygons["features"] + filled)
    write_json(out / "zip_codes.geojson", zip_polygons)

    districts_file = geo.sf_boundary_dir(paths) / CURRENT_SF_DISTRICTS
    shutil.copyfile(districts_file, out / "sfpd_districts.geojson")
    districts = json.loads(districts_file.read_text())["features"]

    # LA crimes have only an area, so census values are estimated from the ZIPs overlapping each area.
    divisions = json.loads((geo.la_boundary_dir(paths) / geo.LAPD_DIVISIONS_FILE).read_text())["features"]
    write_json(out / "lapd_divisions.geojson",
               {"type": "FeatureCollection", "features": simplify_features(divisions, LA_SIMPLIFY_TOLERANCE)})
    area_estimates = area_socioeconomic(divisions, statewide["features"], socio)
    write_json(out / "lapd_area_socioeconomic.json", area_estimates)
    population_note = population_comparison(area_estimates, city_populations())

    division_boundaries = {
        "LA": {division["properties"]["area_name"] for division in divisions},
        "SF": {feature["properties"]["district"].title() for feature in districts},
    }
    polygon_zips = statewide_zips | {feature["properties"]["ZIP_CODE"] for feature in filled}
    sections, failures = check_compatibility(geography, set(socio["Zip_Code"]), polygon_zips, division_boundaries)
    failures += [f"Los Angeles area {estimate['area_name']} has no estimated population"
                 for estimate in area_estimates if not estimate["population"]]

    filled_note = ", ".join(sorted(feature["properties"]["ZIP_CODE"] for feature in filled)) or "none"
    result = "\n".join(f"- {failure}" for failure in failures) or \
        "OK: every SF ZIP and district and every LAPD area has a polygon, and every LAPD area has a population."
    report = [
        "# Data compatibility report",
        f"Written by `crime-pipeline export` at {exported_at} from crime.db built at {metadata['built_at']}. "
        f"Counts are comparable offenses: is_crime = 1, possible_duplicate = 0, "
        f"occurred_date >= {metadata['shared_window_start']}.",
        f"SF ZIPs missing from the statewide ZIP file, filled from the Census ZCTA file: {filled_note}.",
        population_note,
        f"## Result\n\n{result}",
        sections,
    ]
    (out / "compatibility_report.md").write_text("\n\n".join(report) + "\n")

    files = sorted(path for path in out.iterdir() if path.is_file())
    for path in files:
        print(f"{path.name:<30} {path.stat().st_size / 1e6:6.2f} MB")
    print(f"{'Total':<30} {sum(path.stat().st_size for path in files) / 1e6:6.2f} MB in {out}")
    print(f"\n{population_note}")
    for failure in failures:
        print(f"FAILED: {failure}")
    return failures
