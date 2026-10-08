"""Add shared classification and LAPD area details from the lookup tables.

Runs on each city's standardized rows before they are written:
  - NIBRS details (description, category, flags) from nibrs_offenses.csv
  - crime_category / crime_group: one shared scheme for all three cities
  - is_crime: False exactly when crime_group is 'Non-Crime'
  - LA: area number, bureau and approximate center point from lapd_areas.csv
  - SF: police district and ZIP from coordinates (see geo.py)
"""

import pandas as pd

from crime_pipeline import geo, lookups

# Used when a row's code or category has no mapping (checks report these).
FALLBACK_CATEGORY = "All Other"

NIBRS_TEXT_FIELDS = ["nibrs_description", "nibrs_category", "nibrs_group", "crime_against"]
NIBRS_FLAG_FIELDS = ["is_violent", "is_property"]


def as_flags(values):
    return values.map({"1": True, "0": False}).astype("boolean")


def nibrs_category(df):
    nibrs = lookups.read("nibrs_offenses").set_index("nibrs_code")
    return df["nibrs_code"].map(nibrs["crime_category"])


def la_local_category(df):
    """Shared category for LA rows recorded with an old LAPD code instead of a statute."""
    local = lookups.read("la_local_codes").set_index("local_code")["crime_category"]
    return df["source_offense_code"].where(df["statute"].isna()).map(local)


def sf_category(df):
    """Shared category for SF rows: exact category + subcategory match first, then category + '*'."""
    sf_map = lookups.read("sf_category_map")
    wildcard = sf_map["source_offense_subcategory"].eq("*")
    exact = sf_map[~wildcard].set_index(["source_offense_category", "source_offense_subcategory"])["crime_category"]
    by_category = sf_map[wildcard].set_index("source_offense_category")["crime_category"]

    keys = pd.MultiIndex.from_arrays([df["source_offense_category"].astype(object),
                                      df["source_offense_subcategory"].astype(object)])
    matched = pd.Series(exact.reindex(keys).to_numpy(), index=df.index)
    return matched.fillna(df["source_offense_category"].map(by_category))


def add_nibrs_details(df):
    nibrs = lookups.read("nibrs_offenses").set_index("nibrs_code")
    has_code = df["nibrs_code"].notna()
    for col in NIBRS_TEXT_FIELDS:
        df[col] = df["nibrs_code"].map(nibrs[col]).where(has_code, df[col])
    for col in NIBRS_FLAG_FIELDS:
        df[col] = as_flags(df["nibrs_code"].map(nibrs[col])).where(has_code, df[col]).astype("boolean")


def add_categories(df, city):
    if city == "SF":
        category = sf_category(df)
    else:
        category = nibrs_category(df)
        if city == "LA":
            category = category.fillna(la_local_category(df))
    category = category.fillna(FALLBACK_CATEGORY)

    groups = lookups.read("crime_categories").set_index("crime_category")["crime_group"]
    df["crime_category"] = category
    df["crime_group"] = category.map(groups)
    df["is_crime"] = df["crime_group"].ne("Non-Crime")


def add_lapd_areas(df):
    areas = lookups.read("lapd_areas").set_index("area_name")
    division = df["police_division"]
    df["police_division_number"] = division.map(areas["area_number"])
    df["police_bureau"] = division.map(areas["bureau"])
    df["latitude"] = division.map(areas["center_latitude"])
    df["longitude"] = division.map(areas["center_longitude"])
    df["location_is_approximate"] = pd.Series(True, index=df.index, dtype="boolean").mask(df["latitude"].isna())


def add_sf_geography(df, paths):
    df["police_division"] = geo.sf_police_district(df, paths)
    df["zip"] = geo.sf_zip(df, paths)


def apply(df, city, paths):
    """Fill lookup-based columns in place and return df."""
    add_nibrs_details(df)
    add_categories(df, city)
    if city == "LA":
        add_lapd_areas(df)
    if city == "SF":
        add_sf_geography(df, paths)
    return df
