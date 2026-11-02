"""Web export: filtered monthly, daily and hourly counts, city populations, ZIP polygon clipping and the
compatibility check, on made-up data."""

import json
import sqlite3
from collections import Counter
from importlib.resources import files
from pathlib import Path

import pandas as pd
import shapely

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


def test_compatibility_fails_for_an_lapd_area_without_a_polygon():
    geography = [
        {"city": "LA", "zip": None, "division": "Central", "count": 6},
        {"city": "LA", "zip": None, "division": "Rampart", "count": 4},
    ]
    report, failures = export.check_compatibility(
        geography, socio_zips=set(), polygon_zips=set(), division_boundaries={"LA": {"Central"}},
    )
    assert failures == ["Los Angeles area Rampart has no polygon"]
    assert "| Police division → boundary | 2 | 1 | 6 of 10 (60.00%) |" in report

    _, failures = export.check_compatibility(
        geography, socio_zips=set(), polygon_zips=set(), division_boundaries={"LA": {"Central", "Rampart"}},
    )
    assert failures == []


def box_feature(properties, west, south, east, north):
    return {"type": "Feature", "properties": properties,
            "geometry": shapely.geometry.mapping(shapely.box(west, south, east, north))}


def test_area_estimates_weight_zips_by_their_area_inside_the_division():
    # Division 0-2 wide: all of ZIP A (0-1) and half of ZIP B (1-3). ZIP C (5-6) is outside.
    divisions = [box_feature({"area_number": 1, "area_name": "Central"}, 0, 0, 2, 1)]
    zips = [box_feature({"ZIP_CODE": "A"}, 0, 0, 1, 1), box_feature({"ZIP_CODE": "B"}, 1, 0, 3, 1),
            box_feature({"ZIP_CODE": "C"}, 5, 0, 6, 1)]
    socio = pd.DataFrame({
        "Year": ["2023", "2024", "2024", "2024"],
        "Zip_Code": ["A", "A", "B", "C"],
        "Total_Population": ["999", "100", "200", "500"],
        "Median_Household_Income": ["1", "50000", "100000", "1"],
        "Median_Home_Value": ["1", "-666666666", "800000", "1"],  # negative: no Census estimate
        "Below_Poverty_Level": ["999", "10", "40", "500"],
        "Poverty_Rate": ["", "10", "20", "100"],
    })
    assert export.area_socioeconomic(divisions, zips, socio) == [{
        "area_number": 1, "area_name": "Central", "year": 2024,
        "population": 200,            # 100 from A + half of B's 200
        "below_poverty": 30,          # 10 + half of 40
        "poverty_rate": 15.0,
        "median_household_income": 75000,  # A and B each contribute 100 residents
        "median_home_value": 800000,       # A has no value, so only B counts
    }]


def contributions(population, below_poverty, share=(1.0, 0.5)):
    """latest_socioeconomic-style rows for two ZIPs; None marks a missing Census value."""
    return pd.DataFrame({
        "Year": [2024, 2024],
        "Total_Population": pd.Series(population, dtype=float),
        "Median_Household_Income": pd.Series([None, None], dtype=float),
        "Median_Home_Value": pd.Series([None, None], dtype=float),
        "Below_Poverty_Level": pd.Series(below_poverty, dtype=float),
        "share": list(share),
    })


def test_area_estimate_keeps_missing_counts_apart_from_measured_zeros():
    missing = export.area_estimate(contributions([100, 200], [None, None]))
    assert (missing["population"], missing["below_poverty"], missing["poverty_rate"]) == (200, None, None)
    assert missing["median_household_income"] is None

    zero = export.area_estimate(contributions([100, 200], [0, 0]))
    assert (zero["population"], zero["below_poverty"], zero["poverty_rate"]) == (200, 0, 0.0)

    # The rate counts only the ZIP with both values: 10 of 100, not 10 of 200.
    partial = export.area_estimate(contributions([100, 200], [10, None]))
    assert (partial["below_poverty"], partial["poverty_rate"]) == (10, 10.0)


def test_area_estimate_has_no_population_when_no_zip_has_one():
    estimate = export.area_estimate(contributions([None, None], [10, 20]))
    assert (estimate["population"], estimate["poverty_rate"]) == (None, None)
    assert estimate["below_poverty"] == 20


def test_population_comparison_uses_the_census_year_of_the_estimates():
    estimates = [{"year": 2024, "population": 2_000_000}, {"year": 2024, "population": 1_872_710}]
    assert export.population_comparison(estimates, export.city_populations()) == (
        "LAPD area population estimates from 2024 ZIP data add up to 3,872,710; "
        "the Census city estimate for 2024 is 3,872,710 (+0.0%).")


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
    la_dir = paths.boundaries_dir / "la"
    la_dir.mkdir()
    (la_dir / "lapd_divisions.geojson").write_text(json.dumps(collection(
        [feature({"area_number": 1, "area_name": "Central", "area_full_name": "Central", "bureau": "Central"})])))
    paths.census_dir.mkdir()
    (paths.census_dir / export.SOCIOECONOMIC_FILE).write_text(
        "Year,Zip_Code,Total_Population,Median_Household_Income,Median_Home_Value,Below_Poverty_Level\n"
        "2023,92101,40000,1,1,1\n2023,90001,50000,60000,500000,5000\n2023,94110,60000,1,1,1\n")

    assert export.run(paths) == []

    written = {path.name for path in paths.export_dir.iterdir()}
    assert written == {"zip_monthly.json", "division_monthly.json", "daily_counts.json", "hourly_counts.json",
                       "city_population.json", "crime_categories.json", "lapd_areas.json", "metadata.json",
                       "socioeconomic.csv", "zip_codes.geojson", "sfpd_districts.geojson",
                       "lapd_divisions.geojson", "lapd_area_socioeconomic.json", "compatibility_report.md"}
    # Every test ZIP is the same unit square, so the LA area takes all three ZIPs in full.
    assert json.loads((paths.export_dir / "lapd_area_socioeconomic.json").read_text()) == [{
        "area_number": 1, "area_name": "Central", "year": 2023, "population": 150000, "below_poverty": 5002,
        "poverty_rate": 3.3, "median_household_income": 20001, "median_home_value": 166667,
    }]
    divisions = json.loads((paths.export_dir / "lapd_divisions.geojson").read_text())
    assert [f["properties"]["area_name"] for f in divisions["features"]] == ["Central"]
    zip_codes = json.loads((paths.export_dir / "zip_codes.geojson").read_text())
    assert sorted(f["properties"]["ZIP_CODE"] for f in zip_codes["features"]) == ["92101", "94110", "94188"]
    assert "90001" not in (paths.export_dir / "socioeconomic.csv").read_text()
    metadata = json.loads((paths.export_dir / "metadata.json").read_text())
    assert [city["city"] for city in metadata["cities"]] == ["LA", "SD", "SF"]
    assert metadata["cities"][2]["bounds"] == export.CITY_BOUNDS["SF"]
    assert "filled from the Census ZCTA file: 94188" in (paths.export_dir / "compatibility_report.md").read_text()
