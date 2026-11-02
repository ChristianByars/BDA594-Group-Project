"""Web export: filtered monthly, daily and hourly counts, city populations, ZIP polygon clipping and the
compatibility check, on made-up data."""

import json
import sqlite3
from collections import Counter
from importlib.resources import files
from pathlib import Path

from crime_pipeline import export, load
from crime_pipeline.config import Paths

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}

# (city, occurred_date, occurred_time, crime_category, crime_group, police_division, zip, is_crime, possible_duplicate)
OFFENSES = [
    ("San Diego", "2025-01-05", None, "Robbery", "Violent", "Central", "92101", 1, 0),
    ("San Diego", "2025-01-20", None, "Robbery", "Violent", "Central", "92101", 1, 0),
    ("San Diego", "2025-02-01", None, "Burglary", "Property", "Central", "92101", 1, 0),
    ("San Diego", "2024-12-31", None, "Robbery", "Violent", "Central", "92101", 1, 0),                 # before the window
    ("San Francisco", "2025-01-03", "01:15", "Non-Crime", "Non-Crime", "Mission", "94110", 0, 0),  # not a crime
    ("San Francisco", "2025-01-04", "12:00", "Theft", "Property", "Mission", "94110", 1, 1),       # duplicate report
    ("San Francisco", "2025-01-04", "12:45", "Theft", "Property", "Mission", "94110", 1, 0),
    ("San Francisco", "2025-01-05", None, "Theft", "Property", None, None, 1, 0),                  # no coordinates or time
    ("San Francisco", "2025-01-06", "23:05", "Theft", "Property", "Mission", "94188", 1, 0),
    ("Los Angeles", "2025-01-07", "12:30", "Robbery", "Violent", "Central", None, 1, 0),
]


def build_database(path):
    db = sqlite3.connect(path)
    db.executescript(files("crime_pipeline").joinpath("schema.sql").read_text())
    rows = [(city, "County", "06000", str(i), str(i), *rest) for i, (city, *rest) in enumerate(OFFENSES)]
    db.executemany("""INSERT INTO offenses (city, county, county_fips, source_row_id, case_id, occurred_date,
                      occurred_time, crime_category, crime_group, police_division, zip, is_crime,
                      possible_duplicate)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows)
    db.execute(load.BUILD_DAILY_COUNTS)
    db.executemany("INSERT INTO metadata VALUES (?, ?)", [
        ("built_at", "2025-03-01T00:00:00+00:00"), ("pipeline_version", "test"), ("shared_window_start", "2025-01-01"),
    ])
    db.execute("INSERT INTO crime_categories VALUES ('Robbery', 'Violent', 3, 'Taking property by force')")
    db.execute("INSERT INTO lapd_areas VALUES (1, 'Central', 'Central', 'Central', 34.05, -118.25)")
    db.commit()
    return db


def feature(properties):
    return {"type": "Feature", "properties": properties, "geometry": SQUARE}


def collection(features):
    return {"type": "FeatureCollection", "features": features}


def test_monthly_counts_apply_the_default_filters(tmp_path):
    db = build_database(tmp_path / "crime.db")
    assert export.query(db, export.ZIP_MONTHLY) == [
        {"city": "LA", "month": "2025-01", "zip": None, "group": "Violent", "count": 1},
        {"city": "SD", "month": "2025-01", "zip": "92101", "group": "Violent", "count": 2},
        {"city": "SD", "month": "2025-02", "zip": "92101", "group": "Property", "count": 1},
        {"city": "SF", "month": "2025-01", "zip": None, "group": "Property", "count": 1},
        {"city": "SF", "month": "2025-01", "zip": "94110", "group": "Property", "count": 1},
        {"city": "SF", "month": "2025-01", "zip": "94188", "group": "Property", "count": 1},
    ]
    assert export.query(db, export.DIVISION_MONTHLY) == [
        {"city": "LA", "month": "2025-01", "division": "Central", "category": "Robbery", "count": 1},
        {"city": "SD", "month": "2025-01", "division": "Central", "category": "Robbery", "count": 2},
        {"city": "SD", "month": "2025-02", "division": "Central", "category": "Burglary", "count": 1},
        {"city": "SF", "month": "2025-01", "division": None, "category": "Theft", "count": 1},
        {"city": "SF", "month": "2025-01", "division": "Mission", "category": "Theft", "count": 2},
    ]


def test_daily_counts_add_up_to_the_monthly_zip_totals(tmp_path):
    db = build_database(tmp_path / "crime.db")
    daily = export.query(db, export.DAILY_COUNTS)
    assert daily == [
        {"city": "LA", "date": "2025-01-07", "category": "Robbery", "count": 1},
        {"city": "SD", "date": "2025-01-05", "category": "Robbery", "count": 1},
        {"city": "SD", "date": "2025-01-20", "category": "Robbery", "count": 1},
        {"city": "SD", "date": "2025-02-01", "category": "Burglary", "count": 1},
        {"city": "SF", "date": "2025-01-04", "category": "Theft", "count": 1},
        {"city": "SF", "date": "2025-01-05", "category": "Theft", "count": 1},
        {"city": "SF", "date": "2025-01-06", "category": "Theft", "count": 1},
    ]
    daily_totals = Counter()
    for row in daily:
        daily_totals[row["city"]] += row["count"]
    zip_totals = Counter()
    for row in export.query(db, export.ZIP_MONTHLY):
        zip_totals[row["city"]] += row["count"]
    assert daily_totals == zip_totals


def test_hourly_counts_skip_offenses_without_a_time(tmp_path):
    db = build_database(tmp_path / "crime.db")
    assert export.query(db, export.HOURLY_COUNTS) == [
        {"city": "LA", "hour": 12, "group": "Violent", "count": 1},
        {"city": "SF", "hour": 12, "group": "Property", "count": 1},
        {"city": "SF", "hour": 23, "group": "Property", "count": 1},
    ]


def test_city_populations_cover_each_city_from_2020_to_2025():
    populations = export.city_populations()
    assert len(populations) == 18
    assert {(row["city"], row["year"]) for row in populations} == {
        (city, year) for city in ["LA", "SD", "SF"] for year in range(2020, 2026)}
    assert {"city": "SF", "year": 2025, "population": 826079} in populations


def test_clip_keeps_only_requested_zips():
    statewide = collection([feature({"ZIP_CODE": z}) for z in ["92101", "92102", "94110"]])
    clipped = export.clip_zip_polygons(statewide, {"92101", "94110", "99999"})
    assert [f["properties"]["ZIP_CODE"] for f in clipped["features"]] == ["92101", "94110"]


def test_tag_map_city_keeps_polygons_that_overlap_the_city_box():
    # Reaches into SF's box from the south, but its bounding-box center (37.66) is outside the box.
    edge = {"type": "Polygon", "coordinates": [[[-122.50, 37.60], [-122.47, 37.60], [-122.47, 37.72],
                                                [-122.50, 37.72], [-122.50, 37.60]]]}
    features = [{"type": "Feature", "properties": {"ZIP_CODE": "94132"}, "geometry": edge},
                feature({"ZIP_CODE": "99999"})]
    tagged = export.tag_map_city(features)
    assert [f["properties"]["city"] for f in tagged] == ["SF", None]
    assert "city" not in features[0]["properties"]


def test_committed_bundle_maps_every_sf_zip():
    bundle = Path(__file__).resolve().parents[2] / "frontend" / "data"
    sf_zips = {row["zip"] for row in json.loads((bundle / "zip_monthly.json").read_text())
               if row["city"] == "SF" and row["zip"]}
    shapes = json.loads((bundle / "zip_codes.geojson").read_text())["features"]
    sf_mapped = {f["properties"]["ZIP_CODE"] for f in shapes if f["properties"]["city"] == "SF"}
    assert "94132" in sf_mapped
    assert sf_zips <= sf_mapped


def test_committed_daily_counts_match_the_zip_totals():
    bundle = Path(__file__).resolve().parents[2] / "frontend" / "data"
    totals = {}
    for name in ["daily_counts.json", "zip_monthly.json"]:
        city_totals = Counter()
        for row in json.loads((bundle / name).read_text()):
            city_totals[row["city"]] += row["count"]
        totals[name] = city_totals
    assert totals["daily_counts.json"] == totals["zip_monthly.json"]


def test_compatibility_fails_only_for_unmatched_sf_geography():
    geography = [
        {"city": "SD", "zip": "92101", "division": "Central", "count": 5},
        {"city": "SD", "zip": "92161", "division": "Northern", "count": 2},
        {"city": "SF", "zip": "94110", "division": "Mission", "count": 4},
        {"city": "SF", "zip": "94999", "division": "Atlantis", "count": 1},
        {"city": "SF", "zip": None, "division": None, "count": 3},
    ]
    report, failures = export.check_compatibility(
        geography, socio_zips={"92101", "94110"}, polygon_zips={"92101", "94110"},
        division_boundaries={"SF": {"Mission"}},
    )
    assert failures == ["San Francisco ZIP 94999 has no polygon",
                        "San Francisco police district Atlantis has no polygon"]
    assert "ZIPs without a polygon (1): 92161 (2)" in report
    assert "3 with neither, out of 8" in report

    _, failures = export.check_compatibility(
        geography[:3], socio_zips=set(), polygon_zips={"92101", "94110"}, division_boundaries={"SF": {"Mission"}},
    )
    assert failures == []


def test_run_writes_the_bundle_and_fills_sf_zips_from_zcta(tmp_path):
    paths = Paths(tmp_path / "data", export_dir=tmp_path / "web")
    paths.data_dir.mkdir()
    build_database(paths.database).close()
    paths.ca_zip_boundaries.parent.mkdir(parents=True)
    paths.ca_zip_boundaries.write_text(json.dumps(collection(
        [feature({"ZIP_CODE": z}) for z in ["92101", "94110", "90001"]])))
    sf_dir = paths.boundaries_dir / "sf"
    sf_dir.mkdir()
    (sf_dir / "sf_zcta_2020.geojson").write_text(json.dumps(collection(
        [feature({"ZCTA5": z}) for z in ["94110", "94188"]])))
    (sf_dir / "sfpd_districts_current.geojson").write_text(json.dumps(collection([feature({"district": "MISSION"})])))
    paths.census_dir.mkdir()
    (paths.census_dir / export.SOCIOECONOMIC_FILE).write_text(
        "Year,Zip_Code,Total_Population\n2023,92101,40000\n2023,90001,50000\n2023,94110,60000\n")

    assert export.run(paths) == []

    written = {path.name for path in paths.export_dir.iterdir()}
    assert written == {"zip_monthly.json", "division_monthly.json", "daily_counts.json", "hourly_counts.json",
                       "city_population.json", "crime_categories.json", "lapd_areas.json", "metadata.json",
                       "socioeconomic.csv", "zip_codes.geojson", "sfpd_districts.geojson", "compatibility_report.md"}
    zip_codes = json.loads((paths.export_dir / "zip_codes.geojson").read_text())
    assert sorted(f["properties"]["ZIP_CODE"] for f in zip_codes["features"]) == ["92101", "94110", "94188"]
    assert "90001" not in (paths.export_dir / "socioeconomic.csv").read_text()
    metadata = json.loads((paths.export_dir / "metadata.json").read_text())
    assert [city["city"] for city in metadata["cities"]] == ["LA", "SD", "SF"]
    assert metadata["cities"][2]["bounds"] == export.CITY_BOUNDS["SF"]
    assert "filled from the Census ZCTA file: 94188" in (paths.export_dir / "compatibility_report.md").read_text()
