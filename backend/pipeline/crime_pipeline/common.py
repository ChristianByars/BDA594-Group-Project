"""Shared column layout, constants and helpers used by every city."""

import pandas as pd

# One row = one offense. Every city's output has exactly these columns, in this
# order; columns a city doesn't have are left empty.
COLUMNS = [
    # Where
    "city", "county", "county_fips",
    # Identity
    "source_row_id",          # unique per row within a city
    "case_id",                # groups the offenses of one incident/report
    "sf_incident_number",     # SF only: shared by related reports, has placeholder values
    # When (ISO dates, 24h HH:MM times, all Pacific time)
    "occurred_date", "occurred_time", "reported_date", "reported_time",
    "approved_at",            # SD only: when the report was approved
    # Shared classification, comparable across all cities (lookups/crime_categories.csv)
    "crime_category", "crime_group",
    # NIBRS classification (LA and SD; from lookups/nibrs_offenses.csv)
    "nibrs_code", "nibrs_description", "nibrs_category",
    "nibrs_group", "crime_against", "is_violent", "is_property",
    # Offense as the source recorded it
    "source_offense_code", "source_offense_description",
    "source_offense_category", "source_offense_subcategory",
    "source_offense_text",    # LA offense entry / SD code_section, unparsed
    "statute", "legal_code", "offense_class",
    # Status and flags
    "is_crime",               # False when crime_group is 'Non-Crime' (lost property, etc.)
    "possible_duplicate",     # SF only: same incident number + code + date in an earlier report
    "case_status",
    # Geography
    "police_division", "police_division_number", "police_bureau", "service_area", "beat",
    "neighborhood", "zip", "latitude", "longitude", "location_is_approximate",
    # Victims (LA only)
    "victim_count", "total_victim_count", "any_victim_shot",
]

LA_VICTIM_COLUMNS = ["city", "case_id", "victim_id", "victim_age", "victim_shot", "victim_offense_list"]

BOOL_COLUMNS = ["is_violent", "is_property", "is_crime", "possible_duplicate",
                "location_is_approximate", "any_victim_shot"]

CITY_INFO = {
    "LA": ("Los Angeles", "Los Angeles", "06037"),
    "SD": ("San Diego", "San Diego", "06073"),
    "SF": ("San Francisco", "San Francisco", "06075"),
}

# Output file names in StandardizedData/.
OUTPUT_FILES = {
    "LA": "la_offenses.csv",
    "SD": "sd_offenses.csv",
    "SF": "sf_offenses.csv",
}
LA_VICTIMS_FILE = "la_victims.csv"

# Valid NIBRS offense codes (Group A and Group B).
VALID_NIBRS = {
    "09A", "09B", "09C", "100", "11A", "11B", "11C", "11D", "120",
    "13A", "13B", "13C", "200", "210", "220",
    "23A", "23B", "23C", "23D", "23E", "23F", "23G", "23H",
    "240", "250", "26A", "26B", "26C", "26D", "26E", "26F", "26G", "26H",
    "270", "280", "290", "35A", "35B", "36A", "36B", "370",
    "39A", "39B", "39C", "39D", "40A", "40B", "40C", "510", "520",
    "64A", "64B", "720",
    "90A", "90B", "90C", "90D", "90E", "90F", "90G", "90H", "90I", "90J", "90Z",
}

# Read everything as text so codes like "290" and "09A" are not turned into numbers.
READ_AS_TEXT = dict(dtype=str, keep_default_na=False, na_values=[""])


def read_text_csv(path):
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing. Run the earlier pipeline step first (`crime-pipeline all`).")
    return pd.read_csv(path, **READ_AS_TEXT)


def iso_date(values, fmt):
    return pd.to_datetime(values, format=fmt, errors="coerce").dt.strftime("%Y-%m-%d")


def clean_text(values):
    """Strip and collapse whitespace; empty strings become missing."""
    cleaned = values.astype("string").str.replace(r"\s+", " ", regex=True).str.strip()
    return cleaned.mask(cleaned.eq(""))


def whole_number(values):
    """'822.0' -> '822'; anything non-numeric becomes missing."""
    return pd.to_numeric(values, errors="coerce").round().astype("Int64").astype("string")


def finish(df, city):
    """Add city columns, then return exactly COLUMNS in order."""
    df["city"], df["county"], df["county_fips"] = CITY_INFO[city]
    for col in COLUMNS:
        if col not in df:
            df[col] = pd.NA
    return df[COLUMNS]
