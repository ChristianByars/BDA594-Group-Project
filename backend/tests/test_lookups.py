"""Consistency of the lookup CSVs and the mapping rules that use them."""

import pandas as pd

from crime_pipeline import enrich, lookups
from crime_pipeline.common import VALID_NIBRS

CATEGORIES = set(lookups.read("crime_categories")["crime_category"])


def test_every_mapping_points_at_a_known_category():
    for name in ["nibrs_offenses", "sf_category_map", "la_local_codes"]:
        used = set(lookups.read(name)["crime_category"])
        assert used <= CATEGORIES, f"{name}: {used - CATEGORIES}"


def test_lookup_keys_are_unique():
    assert lookups.read("nibrs_offenses")["nibrs_code"].is_unique
    assert lookups.read("la_local_codes")["local_code"].is_unique
    assert not lookups.read("sf_category_map").duplicated(["source_offense_category", "source_offense_subcategory"]).any()


def test_nibrs_lookup_only_has_valid_codes():
    assert set(lookups.read("nibrs_offenses")["nibrs_code"]) <= VALID_NIBRS


def test_lapd_areas_cover_21_areas_in_4_bureaus():
    areas = lookups.read("lapd_areas")
    assert sorted(areas["area_number"].astype(int)) == list(range(1, 22))
    assert areas.groupby("bureau").size().to_dict() == {"Central": 5, "South": 4, "Valley": 7, "West": 5}


def test_sf_exact_subcategory_beats_wildcard():
    df = pd.DataFrame({
        "source_offense_category": ["Larceny Theft", "Larceny Theft", "Unknown Category", None],
        "source_offense_subcategory": ["Theft From Vehicle", "Larceny Theft - Shoplifting", "x", None],
    })
    assert enrich.sf_category(df).tolist()[:2] == ["Theft from Vehicle", "Theft"]
    assert enrich.sf_category(df)[2:].isna().all()


def test_is_crime_follows_non_crime_group():
    df = pd.DataFrame({
        "nibrs_code": ["120", "90I", None], "source_offense_code": [None, None, "999"],
        "statute": ["211", None, None],
        **{c: pd.NA for c in enrich.NIBRS_TEXT_FIELDS + enrich.NIBRS_FLAG_FIELDS},
    })
    enrich.add_categories(df, "LA")
    assert df["crime_category"].tolist() == ["Robbery", "Non-Crime", "Non-Crime"]
    assert df["is_crime"].tolist() == [True, False, False]
